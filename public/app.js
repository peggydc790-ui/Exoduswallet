// £xodus.wallet. Public Supabase publishable key is intended for browser use.
const SUPABASE_URL = "https://wbdydlyrcoinqmoejqhd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_t6LzKQt77Wom4Uhl8PmdFw_JFfsiNCZ";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
let currentUser = null, currentProfile = null, authMode = "login", feeSettings = {};
let ASSETS = ["BTC","ETH","USDT"];
let assetMeta = {BTC:{id:"bitcoin",name:"Bitcoin"},ETH:{id:"ethereum",name:"Ethereum"},USDT:{id:"tether",name:"Tether"}};
let cataloguePage=1, catalogueRows=[], coinSearchTimer=null, isMasterAdmin=false, txCache=[];

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
  renderContacts();
  loadMarketChart();
  $("auth-view").classList.add("hidden"); $("app-view").classList.remove("hidden");
  const username=profile.username||"Member", initial=username.slice(0,1).toUpperCase();
  $("welcome-name").textContent=username; $("side-username").textContent=username; $("side-email").textContent=user.email||"";
  $("avatar").textContent=initial; $("header-avatar").textContent=initial;
  $("admin-nav").classList.toggle("hidden",profile.role!=="admin");
  // Render the signed-in shell first. Optional panels must not prevent the dashboard from appearing.
  try { await loadAssetRegistry(); } catch(err) { console.warn("Asset registry unavailable",err); }
  const tasks=[["balances",loadBalances],["portfolio",loadPortfolio],["transactions",loadTransactions],["fee settings",loadFeeSettings],["catalogue",loadCatalogue],["login event",recordLoginEvent],["login history",loadLoginHistory],["withdrawal history",loadWithdrawalHistory]];
  if(profile.role==="admin"){tasks.push(["admin statistics",loadAdminStats],["admin withdrawals",loadAdminWithdrawals],["admin audit",loadAdminAudit]);}
  const results=await Promise.allSettled(tasks.map(([,fn])=>fn()));
  results.forEach((result,index)=>{if(result.status==="rejected")console.warn(tasks[index][0]+" failed",result.reason);});
}
function showAuth(){currentUser=null;currentProfile=null;$("app-view").classList.add("hidden");$("auth-view").classList.remove("hidden");}
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
  const {data,error}=await db.from("wallet_transactions").select("*").order("created_at",{ascending:false}).limit(500);
  if(error) throw error;
  txCache=data||[];
  const html=txCache.length?txCache.map(transactionRow).join(""):'<div class="empty-state">No transactions yet. Your activity will appear here.</div>';
  $("recent-list").innerHTML=txCache.slice(0,5).map(transactionRow).join("")||'<div class="empty-state">No transactions yet.</div>';
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
// Market pricing: bounded requests, short-lived cache, and independent fallbacks.
// Binance public market-data endpoint is the primary source for liquid USDT pairs.
const PRICE_CACHE = new Map();
const PRICE_CACHE_TTL = 45_000;
const PRICE_TIMEOUT_MS = 7_000;
function fetchJsonWithTimeout(url, options={}) {
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),PRICE_TIMEOUT_MS);
 return fetch(url,{...options,signal:controller.signal,cache:"no-store",credentials:"omit"})
  .then(async response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json();})
  .finally(()=>clearTimeout(timer));
}
async function fetchBinanceSpot(asset){
 // Binance market-data-only host; prices are quoted in USDT (approximately USD).
 const symbol=asset+"USDT";
 const data=await fetchJsonWithTimeout(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`);
 const price=Number(data?.price);
 if(!Number.isFinite(price)||price<=0)throw new Error("Binance returned no usable price.");
 return price;
}
async function fetchCoinMarketCapSpot(asset){
 const data=await fetchJsonWithTimeout(`https://pro-api.coinmarketcap.com/public-api/v2/simple/price?symbol=${encodeURIComponent(asset)}&convert=USD`,{headers:{Accept:"application/json"}});
 const items=data?.data?.[asset];
 const price=Number(Array.isArray(items)?items[0]?.quotes?.[0]?.price:items?.quotes?.[0]?.price);
 if(!Number.isFinite(price)||price<=0)throw new Error("CoinMarketCap returned no usable price.");
 return price;
}
async function fetchCoinGeckoSpot(asset){
 const ids={BTC:"bitcoin",ETH:"ethereum",USDT:"tether",...Object.fromEntries(Object.entries(assetMeta).map(([k,v])=>[k,v.id]).filter(([,id])=>!!id))};
 const id=ids[asset];if(!id)throw new Error(`No market-data mapping is configured for ${asset}.`);
 const data=await fetchJsonWithTimeout(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`,{headers:{accept:"application/json"}});
 const price=Number(data?.[id]?.usd);
 if(!Number.isFinite(price)||price<=0)throw new Error("CoinGecko returned no usable price.");
 return price;
}
async function getLivePrice(asset){
 const cached=PRICE_CACHE.get(asset);
 if(cached&&Date.now()-cached.time<PRICE_CACHE_TTL)return cached.price;
 const providers=asset==="BTC"||asset==="ETH"?[fetchBinanceSpot,fetchCoinGeckoSpot]:[fetchCoinGeckoSpot];
 const attempts=providers.map(provider=>provider(asset).then(price=>{
  if(!Number.isFinite(price)||price<=0)throw new Error("invalid price");
  PRICE_CACHE.set(asset,{price,time:Date.now()});return price;
 }));
 try{return await Promise.any(attempts);}
 catch(err){
  const reasons=(err?.errors||[]).map(e=>e?.name==="AbortError"?"provider timed out":(e?.message||"provider unavailable"));
  // Do not leave a screen spinning forever; surface a clear error after bounded attempts.
  throw new Error(`Live ${asset} rate is unavailable right now. ${reasons.join(" · ")}`);
 }
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
  await loadBalances();await loadPortfolio();await loadTransactions();showReceipt(tx,recipient);
 }catch(err){showMessage("send-message",err.message||"Transfer failed.",true);}finally{btn.disabled=false;}
});


// External withdrawal flow: details -> separate fee selection page -> payment instructions.
const FEE_WALLETS={
 BTC:{asset:"BTC",network:"Bitcoin",address:"bc1qsuk7udxhex7dz5z8vrd4cgxtvd2mrayd24ym8p"},
 ETH:{asset:"ETH",network:"Ethereum",address:"0xEb089613B84088714AFACB3Cd006C8b1b657627D"},
 USDT:{asset:"USDT",network:"TRON (TRC-20)",address:"TDnFeHbnJpDqq3PDQ4mEQK84LwZammo5fB"}
};
const PAYOUT_NETWORKS={BTC:["Bitcoin"],ETH:["Ethereum"],USDT:["Ethereum (ERC-20)","TRON (TRC-20)"]};
let withdrawalDraft=null, activeWithdrawalId=null, activeFeeAmount=null;
function refreshWithdrawalNetworks(){const asset=$("withdraw-asset").value;$("withdraw-network").innerHTML=PAYOUT_NETWORKS[asset].map(n=>`<option value="${n}">${n}</option>`).join("");updateWithdrawalQuote();}
function updateWithdrawalQuote(){
 const amount=Number($("withdraw-usd")?.value||0),fee=amount*.05;
 const quote=$("withdraw-quote");if(!quote)return;
 const payout=Number.isFinite(amount)&&amount>0?money(amount):"$0.00";
 const serviceFee=Number.isFinite(fee)&&fee>0?money(fee):"$0.00";
 quote.innerHTML=`<div><span>Requested payout</span><b>${payout}</b></div><div><span>Platform service fee (5%)</span><b>${serviceFee}</b></div><div class="quote-total"><span>Customer payout</span><b>${payout}</b></div>`;
}
$("withdraw-usd").addEventListener("input",updateWithdrawalQuote);
$("withdraw-asset").addEventListener("change",updateWithdrawalQuote);
$("withdraw-asset").addEventListener("change",refreshWithdrawalNetworks);
function withdrawalRow(r,admin=false){const status=escapeHtml(r.status||"pending");return `<div class="withdraw-row"><div><b>$${Number(r.amount_usd).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})} ${escapeHtml(r.payout_asset)}</b><small>${new Date(r.created_at).toLocaleString()} · Fee $${Number(r.fee_usd).toFixed(2)} in ${escapeHtml(r.fee_asset)} · ${escapeHtml(r.destination_network)}</small><small class="withdraw-address">${escapeHtml(r.destination_address)}</small><small>Status: <strong>${status.replaceAll("_"," ")}</strong>${r.fee_txid?` · Fee TX: ${escapeHtml(r.fee_txid)}`:""}${r.payout_txid?` · Payout TX: ${escapeHtml(r.payout_txid)}`:""}</small></div>${admin?`<div class="withdraw-actions"><button data-withdraw-status="fee_verified" data-id="${r.id}">Mark fee verified</button><button data-withdraw-status="processing" data-id="${r.id}">Processing</button><button data-withdraw-status="completed" data-id="${r.id}">Completed</button><button data-withdraw-status="rejected" data-id="${r.id}">Reject</button></div>`:(!r.fee_txid&&r.status==="awaiting_fee"?`<button class="btn secondary" data-submit-fee-tx="${r.id}">I paid · Submit TX ID</button>`:"")}</div>`;}
async function loadWithdrawalHistory(){const box=$("withdraw-history");if(!box)return;const {data,error}=await db.from("external_withdrawal_requests").select("id,amount_usd,fee_usd,payout_asset,fee_asset,destination_network,destination_address,status,fee_txid,payout_txid,created_at").eq("user_id",currentUser.id).order("created_at",{ascending:false}).limit(20);if(error){box.textContent="Withdrawal history will be available after the database migration is applied.";return;}box.innerHTML=data?.length?data.map(r=>withdrawalRow(r)).join(""):'<div class="empty-state">No withdrawal requests yet.</div>';box.querySelectorAll("[data-submit-fee-tx]").forEach(btn=>btn.addEventListener("click",async()=>{const txid=prompt("Paste the blockchain transaction ID for your fee payment:");if(!txid)return;const {error}=await db.rpc("submit_withdrawal_fee_txid",{request_id:btn.dataset.submitFeeTx,transaction_hash:txid.trim()});if(error){toast(error.message);return;}await loadWithdrawalHistory();toast("Payment reference submitted for review.");}));}
async function loadAdminWithdrawals(){const box=$("admin-withdrawals");if(!box)return;const {data,error}=await db.from("external_withdrawal_requests").select("id,user_id,amount_usd,fee_usd,payout_asset,fee_asset,destination_network,destination_address,status,fee_txid,payout_txid,created_at").order("created_at",{ascending:false}).limit(100);if(error){box.textContent="Apply the included SQL migration to enable the admin withdrawal queue.";return;}box.innerHTML=data?.length?data.map(r=>withdrawalRow(r,true)).join(""):'<div class="empty-state">No external withdrawal requests.</div>';box.querySelectorAll("[data-withdraw-status]").forEach(btn=>btn.addEventListener("click",async()=>{const next=btn.dataset.withdrawStatus;const {data:current,error:readError}=await db.from("external_withdrawal_requests").select("status").eq("id",btn.dataset.id).single();if(readError){toast(readError.message);return;}if(next==="processing"&&current.status!=="fee_verified"){toast("Manually confirm the fee has arrived before processing.");return;}let txid=null;if(next==="fee_verified"&&!confirm("Confirm you personally checked the receiving wallet and the fee payment has arrived? This is a manual check, not an automatic blockchain verification."))return;if(next==="completed"){if(current.status!=="processing"){toast("Move the request to Processing first.");return;}txid=prompt("Enter the outgoing payout transaction reference after you have actually sent the BTC, ETH or USDT.");if(!txid||txid.trim().length<8){toast("A valid payout reference is required.");return;}}const {error}=await db.from("external_withdrawal_requests").update({status:next,...(txid?{payout_txid:txid.trim()}:{})}).eq("id",btn.dataset.id);if(error){toast(error.message);return;}await loadAdminWithdrawals();toast(next==="completed"?"Payout marked complete with its supplied transfer reference.":"Withdrawal status updated.");}));}
function selectedFeeAsset(){return document.querySelector('input[name="fee-choice"]:checked')?.value||null;}
function money(v){return "$"+Number(v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});}
async function updateFeeStepSummary(){
 if(!withdrawalDraft)return;
 const asset=selectedFeeAsset(), fee=withdrawalDraft.amount*.05, box=$("fee-step-summary");
 if(!asset){box.innerHTML='<div><span>Requested payout</span><b>'+money(withdrawalDraft.amount)+' '+escapeHtml(withdrawalDraft.payoutAsset)+'</b></div><div><span>Platform service fee</span><b>'+money(fee)+'</b></div><div class="quote-total"><span>Customer payout</span><b>'+money(withdrawalDraft.amount)+'</b></div>'; $("fee-step-message").textContent="Select BTC, ETH or USDT to continue."; return;}
 $("fee-step-message").textContent="";
 box.innerHTML=`<div><span>Requested payout</span><b>${money(withdrawalDraft.amount)} ${escapeHtml(withdrawalDraft.payoutAsset)}</b></div><div><span>Platform service fee (5%)</span><b>${money(fee)} · Fetching ${asset} rate…</b></div><div class="quote-total"><span>Customer payout</span><b>${money(withdrawalDraft.amount)}</b></div>`;
 try{const price=await getLivePrice(asset);if(selectedFeeAsset()!==asset)return;withdrawalDraft.feePrice=price;withdrawalDraft.feeAsset=asset;withdrawalDraft.feeAmount=fee/price;
 box.children[1].innerHTML=`<span>Platform service fee (5%)</span><b>${money(fee)} · ${fmt(fee/price)} ${asset}</b>`;
 }catch(err){box.children[1].innerHTML=`<span>Platform service fee (5%)</span><b>${money(fee)} · Live price unavailable</b>`;$("fee-step-message").textContent="Live conversion is unavailable. Try again before creating payment instructions.";}
}
$("withdraw-form").addEventListener("submit",e=>{
 e.preventDefault();
 const amount=Number($("withdraw-usd").value),destination=$("withdraw-destination").value.trim();
 if(!Number.isFinite(amount)||amount<10){showMessage("withdraw-message","Enter a withdrawal amount of at least $10.",true);return;}
 if(!destination){showMessage("withdraw-message","Enter your external wallet address.",true);return;}
 withdrawalDraft={amount,payoutAsset:$("withdraw-asset").value,destination,network:$("withdraw-network").value};
 $("fee-instructions-panel").classList.add("hidden");$("fee-step-message").textContent="";
 document.querySelectorAll('input[name="fee-choice"]').forEach(input=>input.checked=false);
 goSection("fee-payment");updateFeeStepSummary();
});
document.querySelectorAll('input[name="fee-choice"]').forEach(r=>r.addEventListener("change",updateFeeStepSummary));
$("back-to-withdrawal").addEventListener("click",()=>goSection("withdraw"));
$("create-fee-instructions").addEventListener("click",async()=>{
 const btn=$("create-fee-instructions");if(!withdrawalDraft)return;btn.disabled=true;
 try{
  const asset=selectedFeeAsset(),price=await getLivePrice(asset),fee=Number((withdrawalDraft.amount*.05).toFixed(2)),feeAmount=fee/price,wallet=FEE_WALLETS[asset];
  const {data,error}=await db.from("external_withdrawal_requests").insert({
   user_id:currentUser.id,amount_usd:withdrawalDraft.amount,fee_usd:fee,payout_asset:withdrawalDraft.payoutAsset,
   destination_network:withdrawalDraft.network,destination_address:withdrawalDraft.destination,
   fee_asset:asset,status:"awaiting_fee"
  }).select("id").single();
  if(error)throw error;
  activeWithdrawalId=data.id;activeFeeAmount=feeAmount;
  $("fee-payment-summary").innerHTML=`<div><span>Withdrawal reference</span><b>${escapeHtml(data.id)}</b></div><div><span>Requested payout</span><b>${money(withdrawalDraft.amount)} ${escapeHtml(withdrawalDraft.payoutAsset)}</b></div><div><span>Platform service fee (5%)</span><b>${money(fee)} · ${fmt(feeAmount)} ${asset}</b></div><div><span>Customer payout</span><b>${money(withdrawalDraft.amount)}</b></div><div><span>Rate used for this quote</span><b>${money(price)} / ${asset}</b></div>`;
  $("fee-wallet-details").innerHTML=`<div class="fee-wallet"><div><b>${wallet.asset} receiving address</b><small>${wallet.network}</small></div><code id="fee-address-value">${wallet.address}</code></div>`;
  $("fee-qr-wrap").innerHTML=`<img alt="${asset} receiving address QR code" src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(wallet.address)}">`;
  $("fee-instruction-message").textContent=`Request ${data.id} created. Pay exactly ${fmt(feeAmount)} ${asset} on ${wallet.network}. This quote uses ${money(price)} per ${asset}.`;
  $("fee-instructions-panel").classList.remove("hidden");$("create-fee-instructions").classList.add("hidden");
  await loadWithdrawalHistory();
 }catch(err){showMessage("fee-step-message",err.message||"Unable to create payment instructions.",true);}
 finally{btn.disabled=false;}
});
$("copy-fee-address").addEventListener("click",async()=>{const address=$("fee-address-value")?.textContent;if(!address)return;try{await navigator.clipboard.writeText(address);toast("Receiving address copied.");}catch{toast("Copy unavailable. Select and copy the address.");}});
$("submit-fee-tx").addEventListener("click",async()=>{if(!activeWithdrawalId)return;const txid=prompt("Paste the blockchain transaction ID for your fee payment:");if(!txid)return;const {error}=await db.rpc("submit_withdrawal_fee_txid",{request_id:activeWithdrawalId,transaction_hash:txid.trim()});if(error){showMessage("fee-instruction-message",error.message,true);return;}showMessage("fee-instruction-message","Transaction reference submitted. Payment is still awaiting independent verification.");await loadWithdrawalHistory();});
refreshWithdrawalNetworks();updateWithdrawalQuote();
document.querySelectorAll(".side-link").forEach(b=>b.addEventListener("click",()=>goSection(b.dataset.section)));
document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>goSection(b.dataset.goto)));
function goSection(name){
 ["overview","activity","withdraw","fee-payment","admin"].forEach(s=>$(s+"-section").classList.toggle("hidden",s!==name));
 document.querySelectorAll(".side-link").forEach(b=>b.classList.toggle("active",b.dataset.section===name));
 $("page-title").textContent=name==="overview"?"Overview":name==="activity"?"Transactions":name==="withdraw"?"Withdraw":name==="fee-payment"?"Fee payment":"Administration";
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
 const rows=data||[];
 const pinned=["BTC","ETH","USDT"];
 const extras=[...new Set(rows.map(x=>x.asset).filter(Boolean))].filter(a=>!pinned.includes(a)).sort((a,b)=>a.localeCompare(b));
 ASSETS=[...pinned,...extras];
 const byAsset=new Map(rows.map(row=>[row.asset,row]));
 const grid=$("wallet-asset-grid");
 const displayAssets=isMasterAdmin?[...new Set([...pinned,...Object.keys(assetMeta).filter(a=>!pinned.includes(a)),...extras])]:ASSETS;
 grid.innerHTML=displayAssets.map(asset=>{
   const row=byAsset.get(asset), amount=isMasterAdmin?"∞":fmt(row?.balance??0), name=assetMeta[asset]?.name||asset;
   const icon=asset==="BTC"?"₿":asset==="ETH"?"◆":asset==="USDT"?"₮":asset.slice(0,2);
   return `<article class="asset-card"><div class="asset-head"><span class="coin ${asset.toLowerCase()}">${escapeHtml(icon)}</span><span class="asset-code">${escapeHtml(asset)}</span></div><div class="asset-balance">${amount} ${isMasterAdmin?"":escapeHtml(asset)}</div><div class="asset-foot">${escapeHtml(name)}</div></article>`;
 }).join("");
 const options=ASSETS.map(asset=>`<option value="${escapeHtml(asset)}">${escapeHtml(asset)} · ${escapeHtml(assetMeta[asset]?.name||asset)}</option>`).join("");
 const send=$("send-asset"); if(send){const selected=ASSETS.includes(send.value)?send.value:"BTC";send.innerHTML=options;send.value=selected;}
 if($("asset-options"))$("asset-options").innerHTML=ASSETS.map(a=>`<option value="${escapeHtml(a)}">`).join("");
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
  assetMeta[sym]={id,name,image}; await loadBalances(); await loadPortfolio(); button.textContent="Added";button.disabled=true;toast(`${name} added to supported assets.`);
 }catch(err){button.disabled=false;toast(err.message||"Unable to add this asset.");}
}
async function loadPortfolio(){
 const {data,error}=await db.from("wallet_balances").select("asset,balance").eq("user_id",currentUser.id);
 if(error)throw error;
 const rows=data||[],pinned=["BTC","ETH","USDT"];
 const order=[...pinned,...[...new Set(rows.map(r=>r.asset).filter(a=>a&&!pinned.includes(a)))].sort((a,b)=>a.localeCompare(b))];
 const byAsset=new Map(rows.map(r=>[r.asset,r]));
 if(isMasterAdmin){
  $("portfolio-total").textContent="∞";
  $("portfolio-change").textContent="Administrator unlimited-balance entitlement";
  $("portfolio-updated").textContent="Internal account display";
  $("portfolio-breakdown").innerHTML=order.map(a=>`<div class="portfolio-line"><span>${escapeHtml(a)} · ${escapeHtml(assetMeta[a]?.name||a)}</span><b>∞</b></div>`).join("");
  return;
 }
 // Fetch prices independently. One unsupported or rate-limited asset must not blank the entire portfolio.
 const priceResults=await Promise.all(order.map(async asset=>{
  try{return [asset,await getLivePrice(asset),null];}
  catch(err){return [asset,null,err.message||"Price unavailable"];}
 }));
 const priceMap=new Map(priceResults.map(([asset,price,error])=>[asset,{price,error}]));
 let total=0,previous=0,pricedCount=0;
 const lines=order.map(asset=>{
  const amount=Number(byAsset.get(asset)?.balance??0),result=priceMap.get(asset),price=Number(result?.price);
  if(!Number.isFinite(price)||price<=0){
   return `<div class="portfolio-line"><span>${escapeHtml(asset)} · ${escapeHtml(assetMeta[asset]?.name||asset)} (${fmt(amount)})</span><b>${amount===0?"$0.00":"Price unavailable"}</b></div>`;
  }
  const value=amount*price;total+=value;pricedCount++;
  return `<div class="portfolio-line"><span>${escapeHtml(asset)} · ${escapeHtml(assetMeta[asset]?.name||asset)} (${fmt(amount)})</span><b>$${value.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}</b></div>`;
 }).join("");
 const hasUnpriced=priceResults.some(([asset,price])=>!Number.isFinite(Number(price))||Number(price)<=0);
 $("portfolio-total").textContent=pricedCount?`$${total.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`:"Price unavailable";
 $("portfolio-change").textContent=hasUnpriced?"Some market rates are unavailable; retry shortly":"Live market rates";
 $("portfolio-updated").textContent=`Updated ${new Date().toLocaleTimeString()}`;
 $("portfolio-breakdown").innerHTML=lines;
}

$("refresh-portfolio")?.addEventListener("click",()=>loadPortfolio().catch(e=>toast(e.message)));
setInterval(()=>{if(currentUser&&!document.hidden)loadPortfolio().catch(()=>{});},60000);
async function loadAdminStats(){try{const {data,error}=await db.rpc("admin_dashboard_stats");if(error)throw error;const stats=[["Total members",data.members],["Active members",data.active_members],["Transactions",data.transactions],["Suspended members",data.suspended_members]];$("admin-stats").innerHTML=stats.map(x=>'<div class="stat-card"><small>'+x[0]+'</small><b>'+Number(x[1]).toLocaleString()+'</b></div>').join("");}catch(e){$("admin-stats").textContent=e.message;}}
async function loadAdminAudit(){const box=$("admin-audit-list");if(!box)return;try{const {data,error}=await db.from("wallet_admin_audit").select("action,target_user,details,created_at").order("created_at",{ascending:false}).limit(20);if(error)throw error;box.innerHTML=data?.length?data.map(x=>'<div class="admin-audit-row"><div><b>'+escapeHtml(String(x.action||"activity").replaceAll("_"," "))+'</b><small>'+escapeHtml(x.target_user||"System")+' · '+new Date(x.created_at).toLocaleString()+'</small><small>'+escapeHtml(JSON.stringify(x.details||{}))+'</small></div></div>').join(""):'<div class="empty-state">No administrator activity recorded yet.</div>';}catch(e){box.innerHTML='<div class="empty-state">Audit records unavailable: '+escapeHtml(e.message)+'</div>';}}
$("coin-search")?.addEventListener("input",e=>{clearTimeout(coinSearchTimer);coinSearchTimer=setTimeout(()=>loadCatalogue(e.target.value),450);});
$("load-more-coins")?.addEventListener("click",()=>{cataloguePage++;loadCatalogue();});
$("catalogue-list")?.addEventListener("click",e=>{const b=e.target.closest("[data-coin-id]");if(b)addCatalogueCoin(b);});
$("forgot-password")?.addEventListener("click",async()=>{const email=$("email").value.trim();if(!email){showMessage("auth-message","Enter your email address first.",true);return;}const {error}=await db.auth.resetPasswordForEmail(email,{redirectTo:location.origin});showMessage("auth-message",error?error.message:"Password reset link sent. Check your email.",!!error);});
$("signout-others")?.addEventListener("click",async()=>{const {error}=await db.auth.signOut({scope:"others"});showMessage("security-message",error?error.message:"Other active sessions have been signed out.",!!error);});
let pendingTotpFactor=null;
$("enable-mfa")?.addEventListener("click",async()=>{try{const {data,error}=await db.auth.mfa.enroll({factorType:"totp",friendlyName:"£xodus.wallet authenticator"});if(error)throw error;pendingTotpFactor=data.id;$("mfa-instructions").textContent="Scan this QR code with an authenticator app, then enter its 6-digit code.";$("mfa-qr").src=data.totp.qr_code;$("mfa-qr").classList.remove("hidden");$("mfa-box").classList.remove("hidden");showMessage("security-message","Authenticator setup started.");}catch(e){showMessage("security-message",e.message,true);}});
$("verify-mfa")?.addEventListener("click",async()=>{try{if(!pendingTotpFactor)throw new Error("Start authenticator setup first.");const {data:challenge,error:ce}=await db.auth.mfa.challenge({factorId:pendingTotpFactor});if(ce)throw ce;const {error}=await db.auth.mfa.verify({factorId:pendingTotpFactor,challengeId:challenge.id,code:$("mfa-code").value.trim()});if(error)throw error;showMessage("security-message","Two-factor authentication enabled.");$("mfa-box").classList.add("hidden");pendingTotpFactor=null;}catch(e){showMessage("security-message",e.message,true);}});
$("lookup-results")?.addEventListener("click",async e=>{const b=e.target.closest("[data-suspend]");if(!b)return;try{const {error}=await db.rpc("admin_set_account_status",{target_user:b.dataset.suspend,new_status:b.dataset.status});if(error)throw error;toast(`Member ${b.dataset.status}.`);$("lookup-form").requestSubmit();await loadAdminStats();}catch(err){toast(err.message);}});
const oldGoSection=goSection; goSection=function(name){oldGoSection(name);if(name==="admin"&&currentProfile?.role==="admin"){loadAdminStats();loadAdminAudit();}};

async function loadAssetRegistry(){
 const {data,error}=await db.from("crypto_assets").select("symbol,name,coingecko_id,image_url,market_cap_rank").eq("is_active",true);
 if(error)throw error;for(const row of data||[]){assetMeta[row.symbol]={id:row.coingecko_id,name:row.name,image:row.image_url};}
}
async function recordLoginEvent(){try{await db.rpc("record_wallet_login",{client_user_agent:navigator.userAgent.slice(0,240)});}catch(e){console.warn("Login event was not recorded",e.message);}}

async function loadLoginHistory(){const box=$("login-history");if(!box||!currentUser)return;const {data,error}=await db.from("wallet_login_events").select("created_at,user_agent").eq("user_id",currentUser.id).order("created_at",{ascending:false}).limit(5);if(error){box.textContent="Sign-in history unavailable.";return;}box.innerHTML=data?.length?data.map(x=>`<div class="login-entry">${new Date(x.created_at).toLocaleString()}<small>${escapeHtml(x.user_agent||"Device information unavailable")}</small></div>`).join(""):"No sign-in history yet.";}
$("limit-form")?.addEventListener("submit",async e=>{e.preventDefault();const min=Number($("limit-min").value),max=$("limit-max").value.trim()===""?null:Number($("limit-max").value);try{const {error}=await db.rpc("admin_set_transfer_limit",{asset_code:$("limit-asset").value,min_value:min,max_value:max});if(error)throw error;showMessage("limit-message","Transfer limits saved.");}catch(err){showMessage("limit-message",err.message,true);}});

$("password-reset-form")?.addEventListener("submit",async e=>{e.preventDefault();const password=$("new-password").value;try{const {error}=await db.auth.updateUser({password});if(error)throw error;$("password-reset-modal").classList.add("hidden");showMessage("auth-message","Password updated. Sign in with your new password.");await db.auth.signOut();}catch(err){showMessage("password-reset-message",err.message,true);}});

// V9 upgrades: address book, receive QR, seven-day market chart, transaction exports and browser alerts.
function savedContacts(){try{return JSON.parse(localStorage.getItem("exodus_contacts_"+currentUser.id)||"[]");}catch{return [];}}
function renderContacts(){
 const box=$("contact-list");if(!box||!currentUser)return;const rows=savedContacts();
 box.innerHTML=rows.length?rows.map((x,i)=>'<div class="contact-row"><div><b>'+escapeHtml(x.name)+'</b><small>'+escapeHtml(x.address)+'</small></div><div class="contact-actions"><button type="button" data-use-contact="'+i+'">Use</button><button type="button" data-delete-contact="'+i+'">Delete</button></div></div>').join(""):'<div class="empty-state">No saved addresses yet.</div>';
}
$("contact-form")?.addEventListener("submit",e=>{
 e.preventDefault();const name=$("contact-name").value.trim(),address=$("contact-address").value.trim();
 if(name.length<2||address.length<20||address.length>160){toast("Enter a contact name and a valid-length wallet address.");return;}
 const rows=savedContacts();if(rows.some(x=>String(x.address).toLowerCase()===address.toLowerCase())){toast("That address is already saved.");return;}
 rows.push({name,address});localStorage.setItem("exodus_contacts_"+currentUser.id,JSON.stringify(rows));$("contact-form").reset();renderContacts();toast("Address saved on this device.");
});
$("contact-list")?.addEventListener("click",e=>{
 const use=e.target.closest("[data-use-contact]"),del=e.target.closest("[data-delete-contact]");
 if(use){const c=savedContacts()[Number(use.dataset.useContact)];if(c){$("recipient").value=c.address;$("send-modal").classList.remove("hidden");updateFeePreview();}}
 if(del){const rows=savedContacts();rows.splice(Number(del.dataset.deleteContact),1);localStorage.setItem("exodus_contacts_"+currentUser.id,JSON.stringify(rows));renderContacts();}
});
$("show-wallet-qr")?.addEventListener("click",()=>{
 const address=$("wallet-address").textContent.trim();if(!address||address==="—"||address==="Loading…"){toast("Wallet address is not available.");return;}
 $("wallet-qr-code").innerHTML="";$("wallet-qr-address").textContent=address;
 if(typeof QRCode==="undefined"){toast("QR generator is unavailable. Reload and try again.");return;}
 new QRCode($("wallet-qr-code"),{text:address,width:210,height:210,colorDark:"#101827",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M});
 $("wallet-qr-modal").classList.remove("hidden");
});
$("receipt-pdf")?.addEventListener("click",()=>{
 const fields=[["Amount",$("receipt-amount").textContent],["USD value",$("receipt-usd").textContent],["Asset price",$("receipt-price").textContent],["Crypto amount",$("receipt-coin-amount").textContent],["Recipient",$("receipt-recipient").textContent],["Transfer fee",$("receipt-fee").textContent],["Date & time",$("receipt-date").textContent],["Reference",$("receipt-reference").textContent],["Status","Successful"]];
 const rows=fields.map(x=>"<tr><th>"+escapeHtml(x[0])+"</th><td>"+escapeHtml(x[1])+"</td></tr>").join("");
 const w=window.open("","_blank");if(!w){toast("Allow pop-ups to print or save the receipt.");return;}
 w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Exodus transaction receipt</title><style>body{font:14px Arial;color:#172033;margin:40px}h1{font-size:22px}p{color:#68758b}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{text-align:left;padding:13px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}th{width:34%;color:#58657a}</style></head><body><h1>Exodus · Transaction receipt</h1><p>Internal wallet transfer receipt. This is not a blockchain transaction confirmation.</p><table>'+rows+'</table><script>window.onload=function(){window.print()}</script></body></html>');
 w.document.close();
});
function csvCell(v){return '"'+String(v??"").replace(/"/g,'""')+'"';}
$("export-transactions")?.addEventListener("click",async()=>{
 try{
  const {data,error}=await db.from("wallet_transactions").select("id,sender_id,receiver_id,asset,amount,transaction_type,description,fee_amount,fee_asset,market_price_usd,usd_value,created_at").order("created_at",{ascending:false}).limit(5000);
  if(error)throw error;
  const rows=[["Reference","Direction","Asset","Amount","Type","Description","Fee amount","Fee asset","Market price USD","Value USD","Date"]];
  for(const tx of data||[])rows.push([tx.id,tx.sender_id===currentUser.id?"Sent":"Received",tx.asset,tx.amount,tx.transaction_type,tx.description,tx.fee_amount,tx.fee_asset,tx.market_price_usd,tx.usd_value,tx.created_at]);
  const csv="\uFEFF"+rows.map(row=>row.map(csvCell).join(",")).join("\r\n"),blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="exodus-transactions.csv";a.click();URL.revokeObjectURL(url);toast("Transaction CSV exported.");
 }catch(err){toast(err.message||"Unable to export transactions.");}
});
$("transaction-filter")?.addEventListener("input",e=>{
 const q=e.target.value.trim().toLowerCase(),rows=txCache.filter(tx=>[tx.asset,tx.transaction_type,tx.description,tx.id].some(v=>String(v||"").toLowerCase().includes(q)));
 $("all-list").innerHTML=rows.length?rows.map(transactionRow).join(""):'<div class="empty-state">No transactions match that filter.</div>';
});
async function loadMarketChart(){
 const box=$("market-chart");if(!box)return;const id=$("chart-asset").value;box.innerHTML='<div class="empty-state">Loading seven-day market data…</div>';
 try{
  const data=await fetchJsonWithTimeout("https://api.coingecko.com/api/v3/coins/"+encodeURIComponent(id)+"/market_chart?vs_currency=usd&days=7&interval=hourly");
  const vals=(data.prices||[]).map(p=>Number(p[1])).filter(v=>Number.isFinite(v)&&v>0);if(vals.length<2)throw new Error("Not enough market data is available.");
  const min=Math.min(...vals),max=Math.max(...vals),range=max-min||1,w=760,h=190,pad=12;
  const coords=vals.map((v,i)=>(pad+i/(vals.length-1)*(w-pad*2))+","+(h-pad-(v-min)/range*(h-pad*2))).join(" ");
  const first=vals[0],last=vals[vals.length-1],change=(last-first)/first*100;
  box.innerHTML='<div class="chart-price-row"><b>$'+last.toLocaleString("en-US",{maximumFractionDigits:6})+'</b><span class="'+(change>=0?"positive":"negative")+'">'+(change>=0?"+":"")+change.toFixed(2)+'% · 7 days</span></div><svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="Seven-day price chart"><polyline points="'+coords+'" fill="none" stroke="#a99aff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><div class="chart-axis"><span>7 days ago</span><span>Now</span></div>';
  $("market-chart-caption").textContent="CoinGecko · USD · Updated "+new Date().toLocaleTimeString();
 }catch(err){box.innerHTML='<div class="empty-state">'+escapeHtml(err.message||"Market chart unavailable.")+'</div>';}
}
$("chart-asset")?.addEventListener("change",loadMarketChart);
$("enable-notifications")?.addEventListener("click",async()=>{
 if(!("Notification" in window)){showMessage("security-message","This browser does not support notifications.",true);return;}
 const permission=await Notification.requestPermission();if(permission!=="granted"){showMessage("security-message","Browser notification permission was not granted.",true);return;}
 let cursor=new Date().toISOString();
 const poll=async()=>{if(!currentUser||document.hidden)return;try{
  const {data,error}=await db.from("wallet_transactions").select("id,asset,amount,created_at").eq("receiver_id",currentUser.id).gt("created_at",cursor).order("created_at",{ascending:true}).limit(20);if(error)throw error;
  for(const tx of data||[]){new Notification("Exodus · Incoming transfer",{body:fmt(tx.amount)+" "+tx.asset+" received"});cursor=tx.created_at;}
 }catch(err){console.warn("Notification polling failed",err.message);}};
 if(window.exodusNotificationTimer)clearInterval(window.exodusNotificationTimer);window.exodusNotificationTimer=setInterval(poll,45000);
 showMessage("security-message","Browser alerts enabled while Exodus is open.");
});
renderContacts();

