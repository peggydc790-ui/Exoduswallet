// £xodus.wallet — internal ledger frontend. Public Supabase publishable key is intended for browser use.
const SUPABASE_URL = "https://wbdydlyrcoinqmoejqhd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_t6LzKQt77Wom4Uhl8PmdFw_JFfsiNCZ";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
let currentUser = null, currentProfile = null, authMode = "login";
const ASSETS = ["BTC","ETH","USDT"];

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
  const {data:profile,error:profileError}=await db.from("profiles").select("id,username,role,created_at").eq("id",user.id).single();
  if(profileError) throw profileError;
  currentProfile=profile;
  $("auth-view").classList.add("hidden"); $("app-view").classList.remove("hidden");
  const username=profile.username||"Member", initial=username.slice(0,1).toUpperCase();
  $("welcome-name").textContent=username; $("side-username").textContent=username; $("side-email").textContent=user.email||"";
  $("avatar").textContent=initial; $("header-avatar").textContent=initial;
  $("admin-nav").classList.toggle("hidden",profile.role!=="admin");
  await loadBalances(); await loadTransactions();
}
function showAuth(){currentUser=null;currentProfile=null;$("app-view").classList.add("hidden");$("auth-view").classList.remove("hidden");}
async function loadBalances(){
  const {data,error}=await db.from("wallet_balances").select("asset,balance").eq("user_id",currentUser.id);
  if(error) throw error;
  for(const asset of ASSETS){const row=(data||[]).find(x=>x.asset===asset);$("balance-"+asset).textContent=`${fmt(row?.balance)} ${asset}`;}
}
function transactionRow(tx){
  const sent=tx.sender_id===currentUser.id;
  const label=tx.transaction_type==="admin_credit"?"Administrator credit":tx.transaction_type==="admin_debit"?"Administrator debit":sent?"Sent to member":"Received from member";
  const sign=tx.transaction_type==="admin_credit"||(!sent&&tx.transaction_type==="transfer")?"+":"−";
  const amountClass=sign==="+"?"positive":"negative";
  const when=new Date(tx.created_at).toLocaleString();
  return `<div class="tx-row"><div class="tx-icon ${amountClass}">${sign==="+"?"↓":"↑"}</div><div class="tx-info"><b>${label}</b><small>${escapeHtml(tx.description||"Internal ledger transfer")} · ${when}</small></div><div class="tx-amount ${amountClass}">${sign}${fmt(tx.amount)} ${tx.asset}</div></div>`;
}
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function loadTransactions(){
  const {data,error}=await db.from("wallet_transactions").select("*").order("created_at",{ascending:false}).limit(50);
  if(error) throw error;
  const html=data?.length?data.map(transactionRow).join(""):'<div class="empty-state">No transactions yet. Your activity will appear here.</div>';
  $("recent-list").innerHTML=(data||[]).slice(0,5).map(transactionRow).join("")||'<div class="empty-state">No transactions yet.</div>';
  $("all-list").innerHTML=html;
}
$("open-send").addEventListener("click",()=>{$("send-modal").classList.remove("hidden");showMessage("send-message","");});
document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>$ (b.dataset.close).classList.add("hidden")));
$("send-modal").addEventListener("click",e=>{if(e.target===$("send-modal"))$("send-modal").classList.add("hidden");});
$("send-form").addEventListener("submit",async e=>{
 e.preventDefault();const btn=e.submitter;btn.disabled=true;showMessage("send-message","Processing transfer…");
 try{
  const {data,error}=await db.rpc("transfer_balance",{recipient_username:$("recipient").value.trim(),asset_code:$("send-asset").value,transfer_amount:Number($("send-amount").value)});
  if(error)throw error;
  showMessage("send-message","Transfer completed. Reference: "+data);
  $("send-form").reset();await loadBalances();await loadTransactions();
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
  box.innerHTML=data?.length?data.map(u=>`<button type="button" class="member-result" data-id="${u.user_id}"><b>@${escapeHtml(u.username)}</b><small>${u.user_id}</small></button>`).join(""):"No matching members.";
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
db.auth.onAuthStateChange((event,session)=>{if(event==="SIGNED_OUT")showAuth();});
db.auth.getSession().then(({data})=>{if(data.session)boot().catch(err=>toast(err.message));});
