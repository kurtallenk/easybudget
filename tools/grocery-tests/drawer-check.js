// Drawer geometry check: NODE_PATH=/vercel/sandbox/node_modules node tools/grocery-tests/drawer-check.js [WxH,...] [template]
// Prints drawer/nav/footer rects, whether Add transaction + Sign out are hit-testable (not covered), overflow flags.
const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:'/usr/local/bin/chromium',args:['--no-sandbox']});
const sizes=(process.argv[2]||'320x568,375x667,390x844,430x932,568x320,844x390').split(',');
const tpl=process.argv[3]||'modern';
for(const s of sizes){const [w,h]=s.split('x').map(Number);
 const p=await b.newPage({viewport:{width:w,height:h}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.goto(`http://127.0.0.1:8731/tools/grocery-tests/preview.html?tpl=${tpl}#/dashboard`);await p.waitForTimeout(900);
 if(w<=1024){await p.click('#bn-more');await p.waitForTimeout(400);}
 const r=await p.evaluate(()=>{const R=e=>{if(!e)return null;const x=e.getBoundingClientRect();return {t:Math.round(x.top),b:Math.round(x.bottom),l:Math.round(x.left),r:Math.round(x.right)}};
  const so=document.querySelector('.sidebar [data-action="sign-out"]'),add=document.querySelector('.sidebar [data-action="quick-add"]'),nav=document.querySelector('#nav'),sb=document.querySelector('#sidebar'),bn=document.querySelector('.bottomnav');
  const hit=e=>{const x=e.getBoundingClientRect();const el=document.elementFromPoint(x.left+x.width/2,x.top+x.height/2);return !!el&&(el===e||e.contains(el))};
  const bnVis=bn&&getComputedStyle(bn).display!=='none';
  return {sb:R(sb),nav:R(nav),navScroll:nav.scrollHeight>nav.clientHeight,add:R(add),so:R(so),soW:Math.round(so.getBoundingClientRect().width),soText:so.textContent.trim(),
   bn:bnVis?R(bn):null,hitAdd:hit(add),hitSO:hit(so),vh:innerHeight,hOverflow:document.documentElement.scrollWidth>innerWidth,sbOverflow:sb.scrollHeight>sb.clientHeight+1}});
 console.log(s,tpl,JSON.stringify(r),errs.length?'ERR'+errs.length:'');await p.close();}
await b.close()})();
