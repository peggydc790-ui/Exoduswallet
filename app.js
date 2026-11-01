// Configure these values after creating your Supabase project.
const SUPABASE_URL = "YOUR_SUPABASE_PROJECT_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
let supabaseClient = null;
if (window.supabase && !SUPABASE_URL.startsWith("YOUR_") && !SUPABASE_ANON_KEY.startsWith("YOUR_")) {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
const modal = document.getElementById("auth-modal");
const form = document.getElementById("auth-form");
const message = document.getElementById("form-message");
const title = document.getElementById("modal-title");
const desc = document.getElementById("modal-desc");
const submit = document.querySelector(".submit-btn");
const switchText = document.getElementById("switch-text");
const switchButton = document.getElementById("switch-mode");
let mode = "signup";
function setMode(next) {
  mode = next;
  title.textContent = mode === "signup" ? "Create your account" : "Welcome back";
  desc.textContent = mode === "signup" ? "Start with a free demo account." : "Log in to your demo account.";
  submit.textContent = mode === "signup" ? "Create account ↗" : "Log in ↗";
  switchText.textContent = mode === "signup" ? "Already registered?" : "New to £xodus.wallet?";
  switchButton.textContent = mode === "signup" ? "Log in" : "Create account";
  document.getElementById("password").autocomplete = mode === "signup" ? "new-password" : "current-password";
  message.textContent = "";
}
function openModal(next) { setMode(next); modal.classList.add("open"); modal.setAttribute("aria-hidden","false"); }
document.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => openModal(b.dataset.open)));
document.querySelector(".modal-close").addEventListener("click", () => { modal.classList.remove("open"); modal.setAttribute("aria-hidden","true"); });
modal.addEventListener("click", e => { if (e.target === modal) document.querySelector(".modal-close").click(); });
switchButton.addEventListener("click", () => setMode(mode === "signup" ? "login" : "signup"));
form.addEventListener("submit", async e => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  if (!supabaseClient) {
    message.textContent = "Setup needed: connect your Supabase project using the instructions in README.md.";
    return;
  }
  submit.disabled = true;
  message.textContent = "Please wait…";
  try {
    const result = mode === "signup"
      ? await supabaseClient.auth.signUp({ email, password })
      : await supabaseClient.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    message.textContent = mode === "signup"
      ? "Account created. Check your email if confirmation is enabled."
      : "Login successful. Dashboard setup is the next build stage.";
  } catch (err) {
    message.textContent = err.message || "Unable to complete that request.";
  } finally { submit.disabled = false; }
});
document.addEventListener("keydown", e => { if (e.key === "Escape") document.querySelector(".modal-close").click(); });
