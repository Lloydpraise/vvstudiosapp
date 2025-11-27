// --- SECTION CONFIGS ---
const sections = {
  ads: {
    title: "Ads Intelligence",
    desc: "Ask AI about your ads performance.",
  },
  obs: {
    title: "Observations",
    desc: "AI reviews patterns in your business data.",
  },
  copy: {
    title: "Copywriting",
    desc: "Get powerful ad copy and captions.",
  },
  scripts: {
    title: "Customer Scripts",
    desc: "Generate phone/email/chat scripts.",
  },
  forms: {
    title: "Form Messages",
    desc: "Draft follow-up or form responses.",
  },
};

let activeSection = "ads";

// --- ELEMENTS ---
const sectionTitle = document.getElementById("section-title");
const sectionDesc = document.getElementById("section-desc");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const sendBtn = document.getElementById("send-btn");

// --- ADD MESSAGE TO UI ---
function addMessage(content, sender = "user") {
  const bubble = document.createElement("div");
  bubble.className = `p-3 rounded-lg max-w-lg mb-2 ${
    sender === "user" ? "bg-gray-700 self-start" : "bg-purple-600 self-end"
  }`;
  bubble.textContent = content;
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// --- RENDER LEARNINGS ---
function renderLearnings(learnings) {
  chatMessages.innerHTML = "";

  if (!learnings || learnings.length === 0) {
    chatMessages.innerHTML = `<div class="text-center text-gray-500">No insights yet for ${sections[activeSection].title}.</div>`;
    return;
  }

  learnings.forEach((item) => {
    const card = document.createElement("div");
    card.className =
      "bg-gray-800 p-3 rounded-lg mb-3 cursor-pointer hover:bg-gray-700 transition";
    card.innerHTML = `
      <strong class="block text-purple-400 mb-1">${item.section
        .replace("_", " ")
        .toUpperCase()}</strong>
      <p class="text-sm text-gray-300">${item.summary}</p>
    `;

    // when user clicks, AI expands on it
    card.addEventListener("click", async () => {
      addMessage(item.summary, "user");
      addMessage("Analyzing this insight...", "ai");
      const reply = await askAI(item.summary);
      const lastBubble = chatMessages.querySelector("div:last-child");
      lastBubble.textContent = reply;
    });

    chatMessages.appendChild(card);
  });
}

// --- FETCH LEARNINGS FROM BACKEND ---
async function fetchLearnings(section) {
  const businessId = localStorage.getItem("BUSINESS_ID");
  if (!businessId) {
    console.error("⚠️ BUSINESS_ID not found in localStorage");
    return [];
  }

  const API_URL =
    window.location.hostname === "localhost"
      ? "http://localhost:54321/functions/v1/get-learnings"
      : "https://xgtnbxdxbbywvzrttixf.functions.supabase.co/get-learnings";

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_id: businessId,
        section,
      }),
    });

    if (!response.ok) throw new Error(await response.text());

    const data = await response.json();
    return data || [];
  } catch (error) {
    console.error("❌ fetchLearnings error:", error);
    return [];
  }
}

// --- CALL AI (ask-copilot) ---
async function askAI(userMessage) {
  const businessId = localStorage.getItem("BUSINESS_ID");
  const API_URL =
    window.location.hostname === "localhost"
      ? "http://localhost:54321/functions/v1/ask-copilot"
      : "https://xgtnbxdxbbywvzrttixf.functions.supabase.co/ask-copilot";

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: userMessage,
        business_id: businessId,
        section: activeSection,
      }),
    });

    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    return data.reply || "No AI response.";
  } catch (error) {
    console.error("⚠️ askAI error:", error);
    return "There was an issue connecting to the AI.";
  }
}

// --- SWITCH SECTION ---
async function handleSectionSwitch(sec) {
  activeSection = sec;
  sectionTitle.textContent = sections[sec].title;
  sectionDesc.textContent = sections[sec].desc;

  chatMessages.innerHTML = `<div class="text-center text-gray-500">Loading insights for ${sections[sec].title}…</div>`;

  const learnings = await fetchLearnings(sec);
  renderLearnings(learnings);
}

// --- EVENT LISTENERS ---
document.querySelectorAll(".section-btn").forEach((btn) => {
  btn.addEventListener("click", () => handleSectionSwitch(btn.dataset.section));
});

sendBtn.addEventListener("click", async () => {
  const msg = chatInput.value.trim();
  if (!msg) return;
  addMessage(msg, "user");
  chatInput.value = "";
  addMessage("Thinking...", "ai");
  const reply = await askAI(msg);
  const lastBubble = chatMessages.querySelector("div:last-child");
  lastBubble.textContent = reply;
});

// --- INITIAL LOAD ---
handleSectionSwitch("ads");

// Wait for essential UI pieces (welcomeName, businessName, packageName) to appear
(function waitForCopilotEssentials(timeoutMs = 3000){
  const start = Date.now();
  function check(){
    const welcome = document.getElementById('welcomeName')?.textContent?.trim();
    const business = document.getElementById('businessName')?.textContent?.trim();
    const packageText = document.getElementById('packageName')?.textContent?.trim();
    if (welcome && business && packageText) {
      try{ if (window && typeof window.vvAppReady === 'function') { window.vvAppReady(); } else { document.dispatchEvent(new Event('vv-app-ready')); } }catch(e){}
      return;
    }
    if (Date.now() - start < timeoutMs) requestAnimationFrame(check);
    else { try{ if (window && typeof window.vvAppReady === 'function') { window.vvAppReady(); } else { document.dispatchEvent(new Event('vv-app-ready')); } }catch(e){} }
  }
  check();
})();
