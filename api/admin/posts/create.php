<?php
declare(strict_types=1);

/**
 * Create a Super Admin message or News & Updates item. Super Admin only.
 *   message: { kind:"message", type: message|important|announcement, title, body,
 *              audience: all|selected, userIds: [1,2] (selected only) }
 *   news:    { kind:"news", type: feature|update|announcement, title, body,
 *              details?, link? }   (always delivered to all users)
 */

require_once __DIR__ . '/../../../includes/api.php';

$adminId = api_admin_guard(['POST']);
$body    = Request::body();

$kind = (new Validator($body))->required('kind')->enum('kind', ['message', 'news'])->values()['kind'];
$types = $kind === 'news' ? AdminRepo::NEWS_TYPES : AdminRepo::MESSAGE_TYPES;

$v = (new Validator($body))
    ->required('type', 'title', 'body')
    ->enum('type', $types)
    ->string('title', 120)
    ->string('body', 500)
    ->nullableString('details', 2000);
if ($kind === 'message') {
    $v->required('audience')->enum('audience', ['all', 'selected']);
}
$clean = $v->values();

$audience = $kind === 'news' ? 'all' : $clean['audience'];
$userIds  = [];
if ($audience === 'selected') {
    $raw = $body['userIds'] ?? null;
    if (!is_array($raw) || !array_is_list($raw) || $raw === [] || count($raw) > AdminRepo::MAX_RECIPIENTS) {
        throw new ApiException('Please check the highlighted fields.', 422, 'validation_failed', ['fields' => ['userIds' => 'Choose at least one user.']]);
    }
    foreach ($raw as $x) {
        if (!is_int($x) && !(is_string($x) && ctype_digit($x))) {
            throw new ApiException('Please check the highlighted fields.', 422, 'validation_failed', ['fields' => ['userIds' => 'That user list is not valid.']]);
        }
        $userIds[] = (int) $x;
    }
}

Response::created(AdminRepo::create($adminId, [
    'kind'     => $kind,
    'type'     => $clean['type'],
    'title'    => $clean['title'],
    'body'     => $clean['body'],
    'details'  => $kind === 'news' ? ($clean['details'] ?? null) : null,
    'link'     => $kind === 'news' ? AdminRepo::cleanLink($body['link'] ?? null) : null,
    'audience' => $audience,
    'userIds'  => $userIds,
]));
