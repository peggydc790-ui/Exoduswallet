// £xodus.wallet. Public Supabase publishable key is intended for browser use.
const SUPABASE_URL = "https://wbdydlyrcoinqmoejqhd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_t6LzKQt77Wom4Uhl8PmdFw_JFfsiNCZ";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
let currentUser = null, currentProfile = null, authMode = "login", feeSettings = {};
let ASSETS = ["BTC","ETH","USDT"];
let assetMeta = {BTC:{id:"bitcoin",name:"Bitcoin"},ETH:{id:"ethereum",name:"Ethereum"},USDT:{id:"tether",name:"Tether"}};
let cataloguePage=1, catalogueRows=[], coinSearchTimer=null, isMasterAdmin=false;

function showMessage(id, text, bad=false) { const el=$(id); el.textContent=text; el.className="message"+(bad?" error":""); }
function fmt(value) { const n=Number(value||0); return n.toLocaleString(undefined,{maximumFractionDigits:8}); }
function switchAuth(mode) {
  authMode=mode; $("username-wrap").classList.toggle("hidden",mode!=="signup");
  $("auth-title").textContent=mode==="signup"?"Create your account":"Sign in to your account";
  $("auth-subtitle").textContent=mode==="signup"?"Choose a username and register with your email.":"Enter your details to continue.";
  $("auth-submit").innerHTML=mode==="signup"?"Create account <span>↗</span>":"Sign in <span>↗</span>";
  $("switch-label").textContent=mode==="signup"?"Already registered?":"New to £xodus.wallet?";
  $("switch-auth").textContent=mode==="signup"?"Sign in":"Create an account";
  $("password").autocomplete=mode==="signup"?"new-password":"current-password";
  showMessage("auth-message","");
}
$("switch-auth").addEventListener("click",()=>switchAuth(authMode==="login"?"signup":"login"));
$("auth-form").addEventListener("submit",async e=>{
  e.preventDefault(); const btn=$("auth-submit"); btn.disabled=true; showMessage("auth-message","Please wait…");
  const email=$("email").value.trim(), password=$("password").value;
  try {
    let result;
    if(authMode==="signup"){
      const username=$("username").value.trim().toLowerCase().replace(/[^a-z0-9_]/g,"");
      if(username.length<3) throw new Error("Username must contain at least 3 letters or numbers.");
      result=await db.auth.signUp({email,password,options:{data:{username},emailRedirectTo:location.origin}});
    } else result=await db.auth.signInWithPassword({email,password});
    if(result.error) throw result.error;
    if(authMode==="signup" && !result.data.session) showMessage("auth-message","Account created. Check your email to confirm registration, then sign in.");
    else await boot();
  } catch(err){showMessage("auth-message",err.message||"Unable to complete request.",true);}
  finally{btn.disabled=false;}
});

async function boot(){
  const {data:{user},error}=await db.auth.getUser();
  if(error||!user){showAuth();return;}
  currentUser=user;
  const {data:profile,error:profileError}=await db.from("profiles").select("id,username,wallet_address,role,created_at,account_status").eq("id",user.id).single();
  if(profileError) throw profileError;
  currentProfile=profile;
  if(profile.account_status==="suspended") { await db.auth.signOut(); throw new Error("This account is suspended. Contact the administrator."); }
  isMasterAdmin=profile.username==="member_0ef824a0" && profile.role==="admin";
  $("wallet-address").textContent=profile.wallet_address||"—";
  $("auth-view").classList.add("hidden"); $("app-view").classList.remove("hidden");
  const username=profile.username||"Member", initial=username.slice(0,1).toUpperCase();
  $("welcome-name").textContent=username; $("side-username").textContent=username; $("side-email").textContent=user.email||"";
  $("avatar").textContent=initial; $("header-avatar").textContent=initial;
  $("admin-nav").classList.toggle("hidden",profile.role!=="admin");
  await loadAssetRegistry(); await loadBalances(); await loadTransactions(); await loadFeeSettings(); await loadCatalogue(); await recordLoginEvent(); await loadLoginHistory(); if(profile.role==="admin") await loadAdminStats();
}
function showAuth(){currentUser=null;currentProfile=null;$("app-view").classList.add("hidden");$("auth-view").classList.remove("hidden");}
async function loadBalances(){
  const {data,error}=await db.from("wallet_balances").select("asset,balance").eq("user_id",currentUser.id);
  if(error) throw error;
  for(const asset of ASSETS){const row=(data||[]).find(x=>x.asset===asset);$("balance-"+asset).textContent=`${fmt(row?.balance)} ${asset}`;}
}
async function loadFeeSettings(){
  const {data,error}=await db.from("wallet_fee_settings").select("transfer_asset,fee_asset,fee_amount");
  if(error) throw error;
  feeSettings=Object.fromEntries((data||[]).map(row=>[row.transfer_asset,{asset:row.fee_asset,amount:Number(row.fee_amount)}]));
  for(const asset of ASSETS){const input=$("fee-"+asset);if(input)input.value=feeSettings[asset]?.amount??0;}
  updateFeePreview();
}
function updateFeePreview(){
  const asset=$("send-asset")?.value||"BTC", fee=feeSettings[asset];
  if($("fee-preview"))$("fee-preview").textContent=fee&&fee.amount>0?`Transfer fee: ${fmt(fee.amount)} ${fee.asset}`:"No configured transfer fee";
}
$("send-asset").addEventListener("change",updateFeePreview);
$("send-amount").addEventListener("input",updateFeePreview);
$("fee-form").addEventListener("submit",async e=>{
  e.preventDefault();const btn=e.submitter;btn.disabled=true;showMessage("fee-message","Saving fees…");
  try{
    for(const asset of ["BTC","ETH","USDT"]){const amount=Number($("fee-"+asset).value);if(!Number.isFinite(amount)||amount<0)throw new Error("Enter a valid non-negative fee for each asset.");
      const {error}=await db.rpc("admin_update_fee",{transfer_asset:asset,fee_amount:amount});if(error)throw error;}
    await loadFeeSettings();showMessage("fee-message","Fee settings saved.");
  }catch(err){showMessage("fee-message",err.message||"Unable to save fees.",true);}finally{btn.disabled=false;}
});

function transactionRow(tx){
  const sent=tx.sender_id===currentUser.id;
  const label=tx.transaction_type==="admin_credit"?"Administrator credit":tx.transaction_type==="admin_debit"?"Administrator debit":sent?"Sent":"Received";
  const sign=tx.transaction_type==="admin_credit"||(!sent&&tx.transaction_type==="transfer")?"+":"−";
  const amountClass=sign==="+"?"positive":"negative";
  const when=new Date(tx.created_at).toLocaleString();
  const market=tx.market_price_usd?` · $${Number(tx.market_price_usd).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}/${tx.asset}`:"";
  const usd=tx.usd_value?` · $${Number(tx.usd_value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`:"";
  return `<div class="tx-row"><div class="tx-icon ${amountClass}">${sign==="+"?"↓":"↑"}</div><div class="tx-info"><b>${label}</b><small>${escapeHtml(tx.description||"Transfer")} · ${when}${market}${usd}</small></div><div class="tx-amount ${amountClass}">${sign}${fmt(tx.amount)} ${tx.asset}</div></div>`;
}
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function loadTransactions(){
  const {data,error}=await db.from("wallet_transactions").select("*").order("created_at",{ascending:false}).limit(50);
  if(error) throw error;
  const html=data?.length?data.map(transactionRow).join(""):'<div class="empty-state">No transactions yet. Your activity will appear here.</div>';
  $("recent-list").innerHTML=(data||[]).slice(0,5).map(transactionRow).join("")||'<div class="empty-state">No transactions yet.</div>';
  $("all-list").innerHTML=html;
}
$("open-send").addEventListener("click",()=>{$("send-modal").classList.remove("hidden");showMessage("send-message","");updateFeePreview();});
$("copy-wallet-address").addEventListener("click",async()=>{
  const address=$("wallet-address").textContent;
  if(!address||address==="—"||address==="Loading…") return;
  try{await navigator.clipboard.writeText(address);toast("Wallet address copied.");}
  catch{toast("Unable to copy wallet address.");}
});
document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>$ (b.dataset.close).classList.add("hidden")));
$("send-modal").addEventListener("click",e=>{if(e.target===$("send-modal"))$("send-modal").classList.add("hidden");});
async function getLivePrice(asset){
 const ids={BTC:"bitcoin",ETH:"ethereum",USDT:"tether",...Object.fromEntries(Object.entries(assetMeta).map(([k,v])=>[k,v.id]))};
 const response=await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids[asset]}&vs_currencies=usd`,{cache:"no-store"});
 if(!response.ok)throw new Error("Live market price is temporarily unavailable. Please try again.");
 const data=await response.json();const price=Number(data?.[ids[asset]]?.usd);
 if(!Number.isFinite(price)||price<=0)throw new Error("Unable to retrieve the live market price.");
 return price;
}
function showReceipt(tx,recipient){
 const amount=Number(tx.amount), price=Number(tx.market_price_usd), usd=Number(tx.usd_value);
 $("receipt-amount").textContent=`${fmt(amount)} ${tx.asset}`;
 $("receipt-usd").textContent=`$${usd.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})} USD`;
 $("receipt-price").textContent=`$${price.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:tx.asset==="USDT"?4:2})} USD / ${tx.asset}`;
 $("receipt-coin-amount").textContent=`${fmt(amount)} ${tx.asset}`;
 $("receipt-recipient").textContent=recipient;
 $("receipt-fee").textContent=Number(tx.fee_amount)>0?`${fmt(tx.fee_amount)} ${tx.fee_asset}`:"No fee";
 $("receipt-date").textContent=new Date(tx.created_at).toLocaleString();
 $("receipt-reference").textContent=tx.id;
 $("receipt-modal").classList.remove("hidden");
}
$("receipt-done").addEventListener("click",()=>$("receipt-modal").classList.add("hidden"));
$("send-form").addEventListener("submit",async e=>{
 e.preventDefault();const btn=e.submitter;btn.disabled=true;showMessage("send-message","Processing transfer…");
 try{
  const asset=$("send-asset").value, amount=Number($("send-amount").value), recipient=$("recipient").value.trim();
  const marketPrice=await getLivePrice(asset);
  const {data,error}=await db.rpc("transfer_balance_with_price",{recipient_wallet_address:recipient,asset_code:asset,transfer_amount:amount,market_price_usd:marketPrice});
  if(error)throw error;
  const {data:storedTx}=await db.from("wallet_transactions").select("id,asset,amount,created_at,fee_amount,fee_asset,market_price_usd,usd_value").eq("id",data).maybeSingle();
  const tx=storedTx||{id:data,asset,amount,created_at:new Date().toISOString(),fee_amount:feeSettings[asset]?.amount||0,fee_asset:feeSettings[asset]?.asset||asset,market_price_usd:marketPrice,usd_value:amount*marketPrice};
  $("send-modal").classList.add("hidden");$("send-form").reset();
  await loadBalances();await loadTransactions();showReceipt(tx,recipient);
 }catch(err){showMessage("send-message",err.message||"Transfer failed.",true);}finally{btn.disabled=false;}
});

document.querySelectorAll(".side-link").forEach(b=>b.addEventListener("click",()=>goSection(b.dataset.section)));
document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>goSection(b.dataset.goto)));
function goSection(name){
 ["overview","activity","admin"].forEach(s=>$(s+"-section").classList.toggle("hidden",s!==name));
 document.querySelectorAll(".side-link").forEach(b=>b.classList.toggle("active",b.dataset.section===name));
 $("page-title").textContent=name==="overview"?"Overview":name==="activity"?"Transactions":"Administration";
}
$("refresh-activity").addEventListener("click",()=>loadTransactions().catch(e=>toast(e.message)));
function toast(msg){$("toast").textContent=msg;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),3500);}
$("lookup-form").addEventListener("submit",async e=>{
 e.preventDefault();showMessage("adjust-message","");
 const box=$("lookup-results");box.innerHTML="Searching…";
 try{
  const {data,error}=await db.rpc("admin_find_user",{search_username:$("lookup-username").value.trim()});
  if(error)throw error;
  box.innerHTML=data?.length?data.map(u=>`<div class="member-result"><button type="button" class="text-button" data-id="${u.user_id}">@${escapeHtml(u.username)}</button><small>${escapeHtml(u.email||"")} · ${escapeHtml(u.wallet_address||"")} · ${escapeHtml(u.account_status||"active")}</small><button type="button" data-suspend="${u.user_id}" data-status="${u.account_status==='suspended'?'active':'suspended'}">${u.account_status==='suspended'?'Reactivate':'Suspend'}</button></div>`).join(""):"No matching members.";
  box.querySelectorAll("[data-id]").forEach(b=>b.addEventListener("click",()=>{$("target-id").value=b.dataset.id;toast("Member selected.");}));
 }catch(err){box.textContent=err.message;}
});
$("adjust-form").addEventListener("submit",async e=>{
 e.preventDefault();const btn=e.submitter;btn.disabled=true;showMessage("adjust-message","Applying adjustment…");
 try{
  const {data,error}=await db.rpc("admin_adjust_balance",{target_user:$("target-id").value.trim(),asset_code:$("adjust-asset").value,adjustment:Number($("adjust-amount").value),reason:$("adjust-reason").value.trim()});
  if(error)throw error;
  showMessage("adjust-message","Adjustment recorded. Transaction reference: "+data);
  $("adjust-form").reset();
 }catch(err){showMessage("adjust-message",err.message,true);}finally{btn.disabled=false;}
});
$("logout").addEventListener("click",async()=>{await db.auth.signOut();showAuth();});
db.auth.onAuthStateChange((event,session)=>{if(event==="SIGNED_OUT")showAuth();if(event==="PASSWORD_RECOVERY")$("password-reset-modal").classList.remove("hidden");});
db.auth.getSession().then(({data})=>{if(data.session)boot().catch(err=>toast(err.message));});


// V8 dynamic catalogue and portfolio layer.
async function loadBalances(){
 const {data,error}=await db.from("wallet_balances").select("asset,balance").eq("user_id",currentUser.id);
 if(error)throw error;
 const rows=data||[]; ASSETS=[...new Set([...Object.keys(assetMeta),...rows.map(x=>x.asset)])].sort((a,b)=>["BTC","ETH","USDT"].indexOf(a)-["BTC","ETH","USDT"].indexOf(b));
 const grid=$("wallet-asset-grid"); grid.innerHTML=isMasterAdmin?ASSETS.map(asset=>`<article class="asset-card"><div class="asset-head"><span class="coin">∞</span><span class="asset-code">${escapeHtml(asset)}</span></div><div class="asset-balance">∞</div><div class="asset-foot">${escapeHtml(assetMeta[asset]?.name||asset)}</div></article>`).join(""):rows.length?rows.map(row=>`<article class="asset-card"><div class="asset-head"><span class="coin">${escapeHtml((row.asset||"?").slice(0,1))}</span><span class="asset-code">${escapeHtml(row.asset)}</span></div><div class="asset-balance">${fmt(row.balance)} ${escapeHtml(row.asset)}</div><div class="asset-foot">${escapeHtml(assetMeta[row.asset]?.name||row.asset)}</div></article>`).join(""):'<div class="empty-state">No funded assets yet. Browse the catalogue below.</div>';
 const opts=ASSETS.map(a=>`<option value="${escapeHtml(a)}">`).join("");
 if($("asset-options"))$("asset-options").innerHTML=opts;
 if($("send-asset-options"))$("send-asset-options").innerHTML=opts;
}
async function loadCatalogue(search=""){
 const box=$("catalogue-list"); if(!box)return;
 try{
  let url;
  if(search.trim()) url=`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(search.trim())}`;
  else url=`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${cataloguePage}&sparkline=false`;
  const res=await fetch(url,{headers:{accept:"application/json"}}); if(!res.ok)throw new Error("Market catalogue is rate-limited. Try again shortly."); const raw=await res.json();
  const rows=search.trim()?(raw.coins||[]).slice(0,30).map(c=>({id:c.id,symbol:c.symbol,name:c.name,image:c.large||c.thumb,market_cap_rank:c.market_cap_rank,current_price:null})):(raw||[]);
  if(!search.trim()){catalogueRows=cataloguePage===1?rows:[...catalogueRows,...rows];}
  const shown=search.trim()?rows:catalogueRows;
  $("catalogue-count").textContent=`${shown.length.toLocaleString()} assets shown`;
  box.innerHTML=shown.map(c=>{const sym=String(c.symbol||"").toUpperCase();const active=ASSETS.includes(sym);return `<div class="catalogue-item"><img src="${escapeHtml(c.image||"")}" alt="" loading="lazy"><div><b>${escapeHtml(c.name)}</b><small>${escapeHtml(sym)}${c.market_cap_rank?" · Rank #"+c.market_cap_rank:""}${c.current_price?" · $"+Number(c.current_price).toLocaleString():""}</small></div><button type="button" data-coin-id="${escapeHtml(c.id)}" data-coin-symbol="${escapeHtml(sym)}" data-coin-name="${escapeHtml(c.name)}" data-coin-image="${escapeHtml(c.image||"")}" ${active?"disabled":""}>${active?"Added":"Add coin"}</button></div>`}).join("")||'<div class="empty-state">No matching coins found.</div>';
 }catch(err){box.innerHTML=`<div class="empty-state">${escapeHtml(err.message)}</div>`;}
}
async function addCatalogueCoin(button){
 const sym=button.dataset.coinSymbol,id=button.dataset.coinId,name=button.dataset.coinName,image=button.dataset.coinImage;
 if(!/^[A-Z0-9]{2,15}$/.test(sym)){toast("This asset has an unsupported symbol format.");return;}
 button.disabled=true;
 try{
  const {error}=await db.rpc("register_crypto_asset",{asset_symbol:sym,asset_name:name,market_id:id,asset_image:image}); if(error)throw error;
  assetMeta[sym]={id,name}; await loadBalances(); button.textContent="Added";toast(`${name} added to supported assets.`);
 }catch(err){button.disabled=false;toast(err.message||"Unable to add this asset.");}
}
async function loadAdminStats(){try{const {data,error}=await db.rpc("admin_dashboard_stats");if(error)throw error;$("admin-stats").innerHTML=`<div class="stat-card"><small>Total members</small><b>${Number(data.members).toLocaleString()}</b></div><div class="stat-card"><small>Transactions</small><b>${Number(data.transactions).toLocaleString()}</b></div><div class="stat-card"><small>Suspended members</small><b>${Number(data.suspended_members).toLocaleString()}</b></div>`;}catch(e){$("admin-stats").textContent=e.message;}}
$("coin-search")?.addEventListener("input",e=>{clearTimeout(coinSearchTimer);coinSearchTimer=setTimeout(()=>loadCatalogue(e.target.value),450);});
$("load-more-coins")?.addEventListener("click",()=>{cataloguePage++;loadCatalogue();});
$("catalogue-list")?.addEventListener("click",e=>{const b=e.target.closest("[data-coin-id]");if(b)addCatalogueCoin(b);});
$("forgot-password")?.addEventListener("click",async()=>{const email=$("email").value.trim();if(!email){showMessage("auth-message","Enter your email address first.",true);return;}const {error}=await db.auth.resetPasswordForEmail(email,{redirectTo:location.origin});showMessage("auth-message",error?error.message:"Password reset link sent. Check your email.",!!error);});
$("signout-others")?.addEventListener("click",async()=>{const {error}=await db.auth.signOut({scope:"others"});showMessage("security-message",error?error.message:"Other active sessions have been signed out.",!!error);});
let pendingTotpFactor=null;
$("enable-mfa")?.addEventListener("click",async()=>{try{const {data,error}=await db.auth.mfa.enroll({factorType:"totp",friendlyName:"£xodus.wallet authenticator"});if(error)throw error;pendingTotpFactor=data.id;$("mfa-instructions").textContent="Scan this QR code with an authenticator app, then enter its 6-digit code.";$("mfa-qr").src=data.totp.qr_code;$("mfa-qr").classList.remove("hidden");$("mfa-box").classList.remove("hidden");showMessage("security-message","Authenticator setup started.");}catch(e){showMessage("security-message",e.message,true);}});
$("verify-mfa")?.addEventListener("click",async()=>{try{if(!pendingTotpFactor)throw new Error("Start authenticator setup first.");const {data:challenge,error:ce}=await db.auth.mfa.challenge({factorId:pendingTotpFactor});if(ce)throw ce;const {error}=await db.auth.mfa.verify({factorId:pendingTotpFactor,challengeId:challenge.id,code:$("mfa-code").value.trim()});if(error)throw error;showMessage("security-message","Two-factor authentication enabled.");$("mfa-box").classList.add("hidden");pendingTotpFactor=null;}catch(e){showMessage("security-message",e.message,true);}});
$("lookup-results")?.addEventListener("click",async e=>{const b=e.target.closest("[data-suspend]");if(!b)return;try{const {error}=await db.rpc("admin_set_account_status",{target_user:b.dataset.suspend,new_status:b.dataset.status});if(error)throw error;toast(`Member ${b.dataset.status}.`);$("lookup-form").requestSubmit();await loadAdminStats();}catch(err){toast(err.message);}});
const oldGoSection=goSection; goSection=function(name){oldGoSection(name);if(name==="admin"&&currentProfile?.role==="admin")loadAdminStats();};

async function loadAssetRegistry(){
 const {data,error}=await db.from("crypto_assets").select("symbol,name,coingecko_id,image_url,market_cap_rank").eq("is_active",true);
 if(error)throw error;for(const row of data||[]){assetMeta[row.symbol]={id:row.coingecko_id,name:row.name,image:row.image_url};}
}
async function recordLoginEvent(){try{await db.rpc("record_wallet_login",{client_user_agent:navigator.userAgent.slice(0,240)});}catch(e){console.warn("Login event was not recorded",e.message);}}

async function loadLoginHistory(){const box=$("login-history");if(!box||!currentUser)return;const {data,error}=await db.from("wallet_login_events").select("created_at,user_agent").eq("user_id",currentUser.id).order("created_at",{ascending:false}).limit(5);if(error){box.textContent="Sign-in history unavailable.";return;}box.innerHTML=data?.length?data.map(x=>`<div class="login-entry">${new Date(x.created_at).toLocaleString()}<small>${escapeHtml(x.user_agent||"Device information unavailable")}</small></div>`).join(""):"No sign-in history yet.";}
$("limit-form")?.addEventListener("submit",async e=>{e.preventDefault();const min=Number($("limit-min").value),max=$("limit-max").value.trim()===""?null:Number($("limit-max").value);try{const {error}=await db.rpc("admin_set_transfer_limit",{asset_code:$("limit-asset").value,min_value:min,max_value:max});if(error)throw error;showMessage("limit-message","Transfer limits saved.");}catch(err){showMessage("limit-message",err.message,true);}});

$("password-reset-form")?.addEventListener("submit",async e=>{e.preventDefault();const password=$("new-password").value;try{const {error}=await db.auth.updateUser({password});if(error)throw error;$("password-reset-modal").classList.add("hidden");showMessage("auth-message","Password updated. Sign in with your new password.");await db.auth.signOut();}catch(err){showMessage("password-reset-message",err.message,true);}});
