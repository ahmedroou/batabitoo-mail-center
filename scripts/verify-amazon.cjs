const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');

const accounts = Array.from({length: 180}, (_, i) => ({
  id:`account-${i}`, email:`ahmedroou${i + 1}@batabitoo.com`, personName:`حساب أمازون ${i + 1}`,
  label:`Amazon ${i + 1}`, isOfficial:true, isAmazon:true, messageCount:(i % 8) + 1,
  banStatus:i % 9 === 0 ? 'confirmed' : i % 7 === 0 ? 'suspected' : 'safe',
  isBanned:i % 9 === 0, banReason:i % 9 === 0 ? 'مشتريات رقمية فقط' : i % 7 === 0 ? 'رسالة تحتاج مراجعة' : '',
  createdAt:new Date(Date.now() - i * 86400000).toISOString()
}));
const messages = Array.from({length: 320}, (_, i) => ({
  id:`message-${i}`, inboxEmail:accounts[i % accounts.length].email, from:'Amazon.sa <account-update@amazon.sa>',
  to:accounts[i % accounts.length].email, subject:i % 4 === 0 ? `رمز التحقق لحسابك ${100000 + i}` : i % 3 === 0 ? `تم شحن طلبك رقم ${i}` : `تحديث حساب أمازون ${i}`,
  intro:'إشعار تجريبي آمن لاختبار واجهة حسابات أمازون.', otp:i % 4 === 0 ? String(100000 + i) : '',
  isAmazon:true, createdAt:new Date(Date.now() - i * 60000).toISOString()
}));

(async () => {
  const browser = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true, args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const results = [];
  try {
    for (const width of [320,390,768,1440,1920]) {
      const page = await browser.newPage({viewport:{width,height:width <= 720 ? 844 : 1050},serviceWorkers:'block'});
      const errors=[]; page.on('pageerror',e=>errors.push(e.message));
      let firestoreWrites=0;
      await page.route('https://firestore.googleapis.com/**', route => {
        if (route.request().method()==='PATCH') { firestoreWrites+=1; return route.fulfill({json:{fields:{banStatus:{stringValue:'confirmed'},isBanned:{booleanValue:true}}}}); }
        return route.fulfill({json:{documents:[]}});
      });
      await page.route('**/api/**', route => {
        if (!['GET','HEAD'].includes(route.request().method())) return route.abort();
        const url = new URL(route.request().url());
        const status={status:'online',cloudConnected:true,counts:{totalInboxes:180,official:180,temp:0,amazon:180,banned:20,suspected:23,messages:320}};
        const inboxData={activeId:accounts[0].id,official:accounts,temp:[],amazon:accounts,banned:accounts.filter(a=>a.banStatus==='confirmed'),suspected:accounts.filter(a=>a.banStatus==='suspected'),inboxes:accounts};
        const messageData={counts:{total:320,official:320,temp:0,amazon:320,banned:0},official:messages,temp:[],amazon:messages,banned:[],messages};
        const body=url.pathname==='/api/status'?status:url.pathname==='/api/inboxes'?inboxData:url.pathname==='/api/inbox/current'?{inbox:accounts[0],messages:messages.slice(0,8)}:url.pathname==='/api/nivea/logs'?{submissions:[]}:messageData;
        return route.fulfill({json:body});
      });
      const started=Date.now();
      await page.goto(process.env.DESIGN_URL || 'http://127.0.0.1:3030',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>typeof switchContentView==='function' && document.querySelectorAll('.inbox-item').length>0);
      await page.evaluate(()=>{ document.querySelector('.workspace').classList.add('show-content'); switchContentView('amazon'); });
      await page.locator('.amazon-account-card').first().waitFor();
      const readyMs=Date.now()-started;
      const initial=await page.evaluate(()=>{
        const hero=document.querySelector('.amazon-hub-hero').getBoundingClientRect();
        const panel=document.querySelector('.content-panel').getBoundingClientRect();
        return {viewport:innerWidth,scroll:document.documentElement.scrollWidth,heroLeft:hero.left,heroRight:hero.right,panelWidth:panel.width,cards:document.querySelectorAll('.amazon-account-card').length,sidebar:getComputedStyle(document.querySelector('.sidebar')).display};
      });
      assert(initial.scroll<=width+1,`overflow ${JSON.stringify(initial)}`);
      assert.equal(initial.cards,24,'initial account DOM must be capped');
      assert.equal(initial.sidebar,'none');
      assert(Math.abs(initial.heroLeft-(width-initial.heroRight))<4,`not centered ${JSON.stringify(initial)}`);
      const filterMs=await page.evaluate(()=>{ const start=performance.now(); document.querySelector('.amazon-stat-tile[data-account-filter="suspected"]').click(); document.querySelector('#amazon-inboxes-reel').offsetHeight; return performance.now()-start; });
      await page.waitForFunction(()=>document.querySelector('#amazon-results-title').textContent.includes('مراجعة'));
      assert(await page.locator('.amazon-account-card.suspected').count()>0);
      const tabMs=await page.evaluate(()=>{ const start=performance.now(); document.querySelector('[data-amazon-view="messages"][data-amazon-filter="all"]').click(); document.querySelector('#amazon-message-list').offsetHeight; return performance.now()-start; });
      await page.waitForFunction(()=>!document.querySelector('#amazon-message-list').classList.contains('hidden'));
      assert.equal(await page.locator('#amazon-message-list .message-card').count(),20,'message DOM must be capped');
      await page.locator('[data-amazon-view="accounts"]').first().click();
      await page.locator('#amazon-search').fill('ahmedroou180');
      await page.waitForFunction(()=>document.querySelectorAll('.amazon-account-card').length===1);
      await page.locator('#amazon-search').fill('');
      if (width===390) {
        const persisted=await page.evaluate(()=>updateBanStatus('account-7','confirmed','اختبار'));
        assert.equal(persisted,true);
        assert.equal(firestoreWrites,1,'404 status endpoint must fall back to Firestore once');
        const transition=await page.evaluate(()=>({
          suspected:state.suspected.some(item=>item.id==='account-7'),
          banned:state.banned.some(item=>item.id==='account-7'),
          official:state.official.find(item=>item.id==='account-7')?.banStatus
        }));
        assert.deepEqual(transition,{suspected:false,banned:true,official:'confirmed'});
        await page.evaluate(()=>loadInboxes());
        assert.equal(await page.evaluate(()=>state.official.find(item=>item.id==='account-7')?.banStatus),'confirmed','manual decision must survive stale sync data');
        await page.evaluate(()=>setAmazonView('accounts','suspected'));
        assert.equal(await page.locator('.amazon-account-card[data-account-id="account-7"]').count(),0);
      }
      await page.screenshot({path:path.resolve(`amazon-accounts-${width}.png`),fullPage:true});
      assert.deepEqual(errors,[]);
      assert(filterMs<120,`filter took ${filterMs}ms`);
      assert(tabMs<120,`tab took ${tabMs}ms`);
      results.push({...initial,readyMs,filterMs,tabMs,passed:true});
      await page.close();
    }
  } finally { await browser.close(); }
  console.log(JSON.stringify(results,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
