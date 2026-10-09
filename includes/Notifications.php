<?php
declare(strict_types=1);

// ============================================================================
// NOTIFICATIONS / INBOX (Round 10)
// ============================================================================
//
// One inbox, three sources, one read-state store:
//
//   source            where it lives                          who sees it
//   ----------------  --------------------------------------  -------------------
//   feed              assets/data/announcements.json (static)  every user
//   admin, all        admin_posts.audience = 'all'             every user
//   admin, selected   admin_posts + a notifications row        only listed users
//
// Read state for ALL of them is the existing per-user `notifications` table
// (read_at). It is keyed by (user_id, id), so it follows the account to any
// browser or device. Identity always comes from the session (api_guard);
// no endpoint accepts a user id for the inbox.

final class NotificationRepo
{
    public const FEED_TYPES = ['feature', 'update', 'announcement', 'important'];
    /** Max items returned / accepted per call. */
    public const MAX_ITEMS = 300;

    /** Admin post ids use this prefix; feed ids with it are ignored so they never collide. */
    public const ADMIN_PREFIX = 'adm_';

    /** @return list<array<string,mixed>> the static feed, normalized like notifications.js used to. */
    public static function feed(): array
    {
        $file = dirname(__DIR__) . '/assets/data/announcements.json';
        if (!is_file($file)) {
            return [];
        }
        $raw = json_decode((string) file_get_contents($file), true);
        $rows = is_array($raw) ? (array_is_list($raw) ? $raw : ($raw['announcements'] ?? [])) : [];
        $out = [];
        foreach ((array) $rows as $a) {
            if (!is_array($a) || !is_string($a['id'] ?? null) || !is_string($a['title'] ?? null)) {
                continue;
            }
            $id = $a['id'];
            if (!preg_match('/^[A-Za-z0-9_-]{1,40}$/', $id) || str_starts_with($id, self::ADMIN_PREFIX) || trim($a['title']) === '') {
                continue;
            }
            $type  = in_array($a['type'] ?? '', self::FEED_TYPES, true) ? $a['type'] : 'announcement';
            $route = is_string($a['route'] ?? null) && preg_match('/^[a-z-]{1,30}$/', $a['route']) ? $a['route'] : '';
            $out[$id] = [
                'id'          => $id,
                'source'      => 'feed',
                'kind'        => 'announcement',
                'type'        => $type,
                'title'       => mb_substr(trim($a['title']), 0, 120),
                'description' => mb_substr(trim((string) ($a['description'] ?? '')), 0, 500),
                'details'     => '',
                'route'       => $route,
                'url'         => '',
                'createdAt'   => (string) ($a['created_at'] ?? ''),
            ];
        }
        return array_values($out);
    }

    /** Link column -> in-app route or external https/http URL. @return array{0:string,1:string} [route, url] */
    public static function splitLink(?string $link): array
    {
        $link = (string) $link;
        if ($link === '') {
            return ['', ''];
        }
        return preg_match('/^[a-z-]{1,30}$/', $link) ? [$link, ''] : ['', $link];
    }

    /** Admin posts this user may see, newest first. @return list<array<string,mixed>> */
    private static function adminItems(int $uid): array
    {
        try {
            $rows = Database::all(
                "SELECT p.`id`,p.`kind`,p.`type`,p.`title`,p.`body`,p.`details`,p.`link`,p.`created_at`, n.`read_at`
                   FROM `admin_posts` p
                   LEFT JOIN `notifications` n ON n.`user_id` = :uid AND n.`id` = p.`id`
                  WHERE p.`audience` = 'all' OR n.`user_id` IS NOT NULL
                  ORDER BY p.`created_at` DESC
                  LIMIT " . self::MAX_ITEMS,
                [':uid' => $uid]
            );
        } catch (PDOException $e) {
            // Migration 008 not applied yet: the inbox still works with the feed.
            Logger::warn('notifications.admin_posts_unavailable', ['msg' => $e->getMessage()]);
            return [];
        }
        return array_map(static function (array $r): array {
            [$route, $url] = self::splitLink($r['link']);
            return [
                'id'          => $r['id'],
                'source'      => 'admin',
                'kind'        => $r['kind'],
                'type'        => $r['type'],
                'title'       => $r['title'],
                'description' => (string) $r['body'],
                'details'     => (string) ($r['details'] ?? ''),
                'route'       => $route,
                'url'         => $url,
                'createdAt'   => Repo::iso($r['created_at']),
                'read'        => $r['read_at'] !== null,
            ];
        }, $rows);
    }

    /** Everything in this user's inbox with its read flag from the database. @return list<array<string,mixed>> */
    public static function all(int $uid): array
    {
        $feed = self::feed();
        $read = [];
        if ($feed !== []) {
            foreach (Database::all(
                "SELECT `id` FROM `notifications` WHERE `user_id` = :uid AND `entity` = 'feed' AND `read_at` IS NOT NULL",
                [':uid' => $uid]
            ) as $r) {
                $read[$r['id']] = true;
            }
        }
        $items = array_map(static fn(array $a): array => $a + ['read' => isset($read[$a['id']])], $feed);
        $items = array_merge(self::adminItems($uid), $items);
        usort($items, static fn(array $a, array $b): int => self::ts($b['createdAt']) <=> self::ts($a['createdAt']));
        return array_slice($items, 0, self::MAX_ITEMS);
    }

    private static function ts(?string $iso): int
    {
        $t = $iso ? strtotime($iso) : false;
        return $t === false ? 0 : $t;
    }

    /**
     * Marks the given ids read for this user. Only ids that are actually in
     * the user's inbox are written, so a user cannot create a delivery for a
     * message that was not sent to them. Idempotent: the first read_at wins.
     *
     * @param list<string>|null $ids null = every item in the inbox (Mark all as read)
     * @return list<array<string,mixed>> the inbox after the change
     */
    public static function markRead(int $uid, ?array $ids): array
    {
        $want = $ids === null ? null : array_flip($ids);
        $now  = Repo::now();
        Database::transaction(static function () use ($uid, $want, $now): void {
            foreach (self::all($uid) as $item) {
                if ($item['read'] || ($want !== null && !isset($want[$item['id']]))) {
                    continue;
                }
                $isFeed = $item['source'] === 'feed';
                Database::run(
                    'INSERT INTO `notifications` (`user_id`,`id`,`kind`,`title`,`entity`,`entity_id`,`read_at`)
                     VALUES (:uid,:id,:kind,:title,:entity,:eid,:now)
                     ON DUPLICATE KEY UPDATE `read_at` = COALESCE(`read_at`, VALUES(`read_at`))',
                    [
                        ':uid'    => $uid,
                        ':id'     => $item['id'],
                        ':kind'   => $isFeed ? 'announcement' : $item['kind'],
                        ':title'  => mb_substr((string) $item['title'], 0, 120),
                        ':entity' => $isFeed ? 'feed' : 'admin_post',
                        ':eid'    => $item['id'],
                        ':now'    => $now,
                    ]
                );
            }
        });
        return self::all($uid);
    }
}

// ============================================================================
// SUPER ADMIN (messages + News & Updates)
// ============================================================================
//
// Every public method here is only reachable through api/admin/*.php, which
// all start with api_admin_guard() (session + CSRF + same origin + role read
// from the database). The repository does not trust its caller for anything
// else either: recipients are re-validated against `users`.

final class AdminRepo
{
    public const MESSAGE_TYPES = ['message', 'important', 'announcement'];
    public const NEWS_TYPES    = ['feature', 'update', 'announcement'];
    public const MAX_RECIPIENTS = 1000;

    /** @return array<string,int> */
    public static function stats(): array
    {
        $u = Database::one(
            "SELECT COUNT(*) AS total,
                    SUM(`status` = 'active') AS active,
                    SUM(`role` = 'super_admin') AS admins
               FROM `users` WHERE `status` <> 'deleted'"
        ) ?? [];
        $p = Database::one(
            "SELECT SUM(`kind` = 'message') AS messages, SUM(`kind` = 'news') AS news FROM `admin_posts`"
        ) ?? [];
        return [
            'users'    => (int) ($u['total'] ?? 0),
            'active'   => (int) ($u['active'] ?? 0),
            'admins'   => (int) ($u['admins'] ?? 0),
            'messages' => (int) ($p['messages'] ?? 0),
            'news'     => (int) ($p['news'] ?? 0),
        ];
    }

    /** @return list<array<string,mixed>> */
    public static function posts(int $limit = 200): array
    {
        $rows = Database::all(
            "SELECT p.*, u.`email` AS author_email,
                    (SELECT COUNT(*) FROM `notifications` n
                      WHERE n.`id` = p.`id` AND n.`entity` = 'admin_post' AND n.`read_at` IS NOT NULL) AS read_count
               FROM `admin_posts` p LEFT JOIN `users` u ON u.`id` = p.`created_by`
              ORDER BY p.`created_at` DESC LIMIT " . max(1, min(500, $limit))
        );
        return array_map([self::class, 'out'], $rows);
    }

    /** @param array<string,mixed> $r */
    private static function out(array $r): array
    {
        [$route, $url] = NotificationRepo::splitLink($r['link'] ?? null);
        $o = [
            'id'             => $r['id'],
            'kind'           => $r['kind'],
            'type'           => $r['type'],
            'title'          => $r['title'],
            'body'           => $r['body'],
            'details'        => (string) ($r['details'] ?? ''),
            'link'           => (string) ($r['link'] ?? ''),
            'route'          => $route,
            'url'            => $url,
            'audience'       => $r['audience'],
            'recipientCount' => (int) $r['recipient_count'],
            'readCount'      => (int) ($r['read_count'] ?? 0),
            'author'         => $r['author_email'] ?? null,
            'createdAt'      => Repo::iso($r['created_at']),
            'updatedAt'      => Repo::iso($r['updated_at']),
        ];
        if ($r['audience'] === 'selected') {
            $o['recipients'] = array_map(static fn(array $x): array => [
                'id' => (int) $x['id'], 'email' => $x['email'], 'displayName' => $x['display_name'],
            ], Database::all(
                "SELECT u.`id`,u.`email`,u.`display_name` FROM `notifications` n JOIN `users` u ON u.`id` = n.`user_id`
                  WHERE n.`id` = :id AND n.`entity` = 'admin_post' ORDER BY u.`email` LIMIT 200",
                [':id' => $r['id']]
            ));
        }
        return $o;
    }

    /** @return array<string,mixed>|null */
    public static function find(string $id): ?array
    {
        $r = Database::one(
            "SELECT p.*, u.`email` AS author_email,
                    (SELECT COUNT(*) FROM `notifications` n
                      WHERE n.`id` = p.`id` AND n.`entity` = 'admin_post' AND n.`read_at` IS NOT NULL) AS read_count
               FROM `admin_posts` p LEFT JOIN `users` u ON u.`id` = p.`created_by` WHERE p.`id` = :id",
            [':id' => $id]
        );
        return $r === null ? null : self::out($r);
    }

    /** User directory for the recipient picker. No secrets (hash, tokens) ever leave this query. */
    public static function users(?string $q, int $limit = 50): array
    {
        $sql = "SELECT `id`,`email`,`display_name`,`status`,`role`,`created_at`,`last_login_at`
                  FROM `users` WHERE `status` <> 'deleted'";
        $params = [];
        if ($q !== null && $q !== '') {
            $like = '%' . addcslashes($q, '%_\\') . '%';
            $sql .= ' AND (`email` LIKE :q1 OR `display_name` LIKE :q2)';
            $params = [':q1' => $like, ':q2' => $like];
        }
        $sql .= ' ORDER BY `email` LIMIT ' . max(1, min(200, $limit));
        return array_map(static fn(array $r): array => [
            'id'          => (int) $r['id'],
            'email'       => $r['email'],
            'displayName' => $r['display_name'],
            'status'      => $r['status'],
            'role'        => $r['role'],
            'createdAt'   => Repo::iso($r['created_at']),
            'lastLoginAt' => Repo::iso($r['last_login_at']),
        ], Database::all($sql, $params));
    }

    /** Optional link: an in-app page name (e.g. "goals") or an http(s) URL. */
    public static function cleanLink($link): ?string
    {
        if ($link === null || $link === '') {
            return null;
        }
        $link = is_string($link) ? trim($link) : '';
        if (preg_match('/^[a-z-]{1,30}$/', $link)) {
            return $link;
        }
        $ok = strlen($link) <= 500 && filter_var($link, FILTER_VALIDATE_URL) !== false
            && in_array(strtolower((string) parse_url($link, PHP_URL_SCHEME)), ['https', 'http'], true);
        if (!$ok) {
            throw new ApiException('Please check the highlighted fields.', 422, 'validation_failed',
                ['fields' => ['link' => 'Use a page name such as "goals" or a full https:// link.']]);
        }
        return $link;
    }

    /**
     * @param array{kind:string,type:string,title:string,body:string,details:?string,link:?string,audience:string,userIds:list<int>} $d
     * @return array<string,mixed>
     */
    public static function create(int $adminId, array $d): array
    {
        $id = NotificationRepo::ADMIN_PREFIX . bin2hex(random_bytes(8));
        $post = Database::transaction(static function () use ($adminId, $d, $id): array {
            $recipients = [];
            if ($d['audience'] === 'selected') {
                $ids = array_values(array_unique(array_map('intval', $d['userIds'])));
                if ($ids !== []) {
                    $in = implode(',', array_fill(0, count($ids), '?'));
                    $recipients = array_map(static fn(array $r): int => (int) $r['id'], Database::all(
                        "SELECT `id` FROM `users` WHERE `status` = 'active' AND `id` IN ($in)", $ids
                    ));
                }
                if ($recipients === []) {
                    throw new ApiException('Please check the highlighted fields.', 422, 'validation_failed',
                        ['fields' => ['userIds' => 'Choose at least one active user.']]);
                }
                $count = count($recipients);
            } else {
                $count = (int) Database::scalar("SELECT COUNT(*) FROM `users` WHERE `status` = 'active'");
            }

            Database::run(
                'INSERT INTO `admin_posts` (`id`,`kind`,`type`,`title`,`body`,`details`,`link`,`audience`,`recipient_count`,`created_by`,`created_at`)
                 VALUES (:id,:kind,:type,:title,:body,:details,:link,:aud,:cnt,:by,:now)',
                [':id' => $id, ':kind' => $d['kind'], ':type' => $d['type'], ':title' => $d['title'], ':body' => $d['body'],
                 ':details' => $d['details'], ':link' => $d['link'], ':aud' => $d['audience'], ':cnt' => $count,
                 ':by' => $adminId, ':now' => Repo::now()]
            );
            foreach ($recipients as $rid) {
                Database::run(
                    "INSERT INTO `notifications` (`user_id`,`id`,`kind`,`title`,`body`,`entity`,`entity_id`)
                     VALUES (:uid,:id,:kind,:title,:body,'admin_post',:eid)",
                    [':uid' => $rid, ':id' => $id, ':kind' => $d['kind'], ':title' => $d['title'],
                     ':body' => $d['body'], ':eid' => $id]
                );
            }
            return self::find($id) ?? [];
        });
        Audit::log($adminId, 'admin.post_created', 'admin_post', $id,
            ['kind' => $d['kind'], 'audience' => $d['audience'], 'recipients' => $post['recipientCount'] ?? 0]);
        return $post;
    }

    /** Content edits only; the audience of a sent item never changes. @param array<string,mixed> $patch */
    public static function update(int $adminId, string $id, array $patch): array
    {
        $cur = self::find($id);
        if ($cur === null) {
            throw new ApiException('That item could not be found.', 404, 'not_found');
        }
        $allowed = $cur['kind'] === 'news' ? self::NEWS_TYPES : self::MESSAGE_TYPES;
        if (isset($patch['type']) && !in_array($patch['type'], $allowed, true)) {
            throw new ApiException('Please check the highlighted fields.', 422, 'validation_failed',
                ['fields' => ['type' => 'Please choose one of the available options.']]);
        }
        $cols = ['type' => 'type', 'title' => 'title', 'body' => 'body', 'details' => 'details', 'link' => 'link'];
        $set = []; $params = [':id' => $id];
        foreach ($cols as $k => $col) {
            if (array_key_exists($k, $patch)) {
                $set[] = "`$col` = :$k";
                $params[":$k"] = $patch[$k];
            }
        }
        if ($set !== []) {
            Database::transaction(static function () use ($set, $params, $id, $patch): void {
                Database::run('UPDATE `admin_posts` SET ' . implode(',', $set) . ' WHERE `id` = :id', $params);
                if (isset($patch['title'])) {
                    Database::run("UPDATE `notifications` SET `title` = :t WHERE `id` = :id AND `entity` = 'admin_post'",
                        [':t' => $patch['title'], ':id' => $id]);
                }
            });
            Audit::log($adminId, 'admin.post_updated', 'admin_post', $id, ['fields' => array_keys($patch)]);
        }
        return self::find($id) ?? [];
    }

    /** Removes the item from every inbox (deliveries + read receipts) and deletes it. */
    public static function delete(int $adminId, string $id): void
    {
        $n = Database::transaction(static function () use ($id): int {
            Database::run("DELETE FROM `notifications` WHERE `id` = :id AND `entity` = 'admin_post'", [':id' => $id]);
            return Database::run('DELETE FROM `admin_posts` WHERE `id` = :id', [':id' => $id]);
        });
        if ($n === 0) {
            throw new ApiException('That item could not be found.', 404, 'not_found');
        }
        Audit::log($adminId, 'admin.post_deleted', 'admin_post', $id);
    }
}
