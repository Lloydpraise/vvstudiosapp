import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "https://esm.sh/openai@4.0.0";

// --- 1. CONFIGURATION ---
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, supabaseKey);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- 2. STATE MANAGEMENT ---
interface SessionBriefcase {
  userText: string;
  userId: string;
  businessId: string;
  conversationId: string;
  platform: string;
  media: any;
  is_simulation: boolean;
  summary: string;       
  recentChat: any[];     
  prompts: any;          
  activeTools: any[]; 
  stage: string;   
  customerProfile: any;
  cart: any;             // 🔥 NEW: Cart state
  notes: string;         // 🔥 NEW: Contact notes
  librarianFacts: any[]; 
  chefData: any[];
  thoughts: any[];
  visionFacts?: any;
  eqBriefcase?: any;      
  uiDispatched?: boolean;
  performance_metrics: { [key: string]: string };
  logs: any[];           // 🔥 NEW: Telemetry logs array
}

const backgroundTasks: Promise<any>[] = [];
const getTs = (start: number) => `${(performance.now() - start).toFixed(0)}ms`;

// --- NEW: CENTRAL LOGGER ---
function createLogger(briefcase: SessionBriefcase) {
  return {
    info: (source: string, message: string, metadata: any = {}) => logEvent(briefcase, 'info', source, message, metadata),
    error: (source: string, message: string, metadata: any = {}) => logEvent(briefcase, 'error', source, message, metadata),
    warn: (source: string, message: string, metadata: any = {}) => logEvent(briefcase, 'warn', source, message, metadata)
  };
}

async function logEvent(briefcase: SessionBriefcase, level: string, source: string, message: string, metadata: any) {
  const timestamp = new Date().toISOString();
  const logEntry = { timestamp, level, source, message, metadata };

  // 1. Always push to simulation logs for UI
  briefcase.logs.push(logEntry);

  // 2. Standard Console Log
  if (level === 'error') console.error(`[${source}] ${message}`, metadata);
  else console.log(`[${source}] ${message}`, metadata);

  // 3. Save to tech_logs if Live Mode
  if (!briefcase.is_simulation) {
    backgroundTasks.push(
      supabase.from('tech_logs').insert([{
        business_id: briefcase.businessId,
        conversation_id: briefcase.conversationId,
        level,
        source,
        message,
        metadata
      }])
    );
  }
}

// --- 3. CORE HELPERS ---

async function callSummarizer(briefcase: SessionBriefcase, logger: any) {
  // Run summarizer earlier so manager/sales AI get updated context sooner
  if (briefcase.recentChat.length < 4) return briefcase.summary;
  
  const start = performance.now();
  const historyString = briefcase.recentChat.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n");

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Summarize the conversation so far in 2 concise sentences. Focus on user intent and key data found." },
        { role: "user", content: `CHAT HISTORY:\n${historyString}` }
      ]
    });
    
    const summary = res.choices[0].message.content || "";
    briefcase.thoughts.push({ agent: "summarizer", output: summary, duration: getTs(start) });
    logger.info("SUMMARIZER", `Generated new summary in ${getTs(start)}`);
    return summary;
  } catch (e) {
    logger.error("SUMMARIZER", "Summarizer failed", { error: e.message });
    return briefcase.summary;
  }
}

async function dispatchOutbound(payload: any, briefcase: SessionBriefcase, logger: any) {
  // 🔥 FIX: Changed to "outbound_ui" so the Frontend catches product cards in simulation
  briefcase.thoughts.push({ type: "outbound_ui", detail: payload, ts: Date.now() });
  logger.info("DISPATCH", `Queuing outbound payload: ${payload.type}`, { payloadType: payload.type });

  if (briefcase.is_simulation) return;

  const target = briefcase.platform === "whatsapp" ? "whatsapp-outbound" : "meta-outbound";
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/${target}`, {
      method: "POST", 
      headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" }, 
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    logger.info("DISPATCH", `Dispatched successfully to ${target}`);
  } catch (e) { 
    logger.error("DISPATCH", `Error dispatching to ${target}`, { error: e.message }); 
  }
}

// --- 4. PARALLEL PERIPHERAL AGENTS ---

async function callEQAnalyst(briefcase: SessionBriefcase, logger: any) {
  const start = performance.now();
  // Provide a slightly larger recent context for better EQ detection
  const recentContext = briefcase.recentChat.slice(-5).map(m => `${m.role}: ${m.content}`).join("\n");
  const sysPrompt = `Analyze user emotion. Format JSON: { "is_emotional": boolean, "sales_hook": "string" }`;
  
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini", 
      temperature: 0, 
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sysPrompt }, 
        { role: "user", content: `USER: ${briefcase.userText}\nCONTEXT:\n${recentContext}` }
      ]
    });

    const result = JSON.parse(res.choices[0].message.content || "{}");
    briefcase.thoughts.push({ agent: "eq_analyst", output: result, duration: getTs(start) });
    logger.info("EQ_ANALYST", `EQ Analysis done in ${getTs(start)}`);
    return result;

  } catch (e) { 
    briefcase.thoughts.push({ agent: "eq_analyst", error: e.message, duration: getTs(start) });
    logger.error("EQ_ANALYST", "EQ Analyst failed", { error: e.message });
    return { is_emotional: false }; 
  }
}

function distillTools(tools: any[]) {
  return tools.map(t => {
    let argsInfo = "none";
    if (t.parameters?.properties) {
      const props = t.parameters.properties;
      argsInfo = Object.keys(props).map(key => `${key}${props[key].description ? ` (${props[key].description})` : ""}`).join(", ");
    } 
    return `• NAME: ${t.name}\n  DESC: ${t.description}\n  ARGS: {${argsInfo}}`;
  }).join("\n\n");
}

// --- 5. THE MANAGER & TOOL EXECUTOR ---

async function callManager(briefcase: SessionBriefcase, logger: any) {
  const start = performance.now();
  const distilledTools = distillTools(briefcase.activeTools);
  const config = briefcase.prompts;

  const sysPrompt = `
${config.manager_ai_prompt || "You are the Orchestrator."}

---
STRICT OUTPUT RULE:
Return ONLY a JSON object with these keys:
{
  "thought": "Brief reasoning for your decision",
  "target": "TOOLS", "LIBRARIAN", or "SERVER",
  "tasks": [{"name": "tool_name", "args": {}}],
  "holding_message": "Short status update for the user",
  "new_stage": "The next conversation stage"
}
---
AVAILABLE TOOLS:
${distilledTools}
`.trim();

  // 🔥 ENRICHED CONTEXT: Injecting Cart, Summary, and Notes
  const userContent: any[] = [
    { 
      type: "text", 
      text: `STAGE: ${briefcase.stage}
SUMMARY: ${briefcase.summary || "None"}
CART_STATE: ${JSON.stringify(briefcase.cart || "Empty")}
CONTACT_NOTES: ${briefcase.notes || "None"}
HISTORY: ${JSON.stringify(briefcase.recentChat.slice(-8))}
CUSTOMER_PROFILE: ${JSON.stringify(briefcase.customerProfile || {})}
INPUT: ${briefcase.userText}` 
    }
  ];

  if (briefcase.media?.url) {
    userContent.push({ type: "image_url", image_url: { url: briefcase.media.url, detail: "low" } });
  }

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini", 
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: sysPrompt }, { role: "user", content: userContent }]
    });

    const output = JSON.parse(res.choices[0].message.content || "{}");
    
    briefcase.thoughts.push({ 
      agent: "manager", 
      thought: output.thought || "No thought provided",
      instruction: { target: output.target, tasks: output.tasks, new_stage: output.new_stage },
      duration: getTs(start)
    });

    logger.info("MANAGER", `Decision made: ${output.target} in ${getTs(start)}`, { instruction: output });
    return output;

  } catch (e) { 
    briefcase.thoughts.push({ agent: "manager", error: e.message, duration: getTs(start) });
    logger.error("MANAGER", "Manager AI failed", { error: e.message });
    return { target: "SERVER", thought: "Fallback due to error", tasks: [], new_stage: briefcase.stage }; 
  }
}

async function executeTools(briefcase: SessionBriefcase, toolsToRun: any[], logger: any) {
  const start = performance.now();
  logger.info("TOOL_EXECUTOR", `Executing ${toolsToRun.length} tasks...`, { tools: toolsToRun });

  const formattedTools = toolsToRun.map((t, i) => ({
    id: `call_${Date.now()}_${i}`,
    name: t.name, 
    args: t.args || {}
  }));

  try {
    const toolResponse = await fetch(`${supabaseUrl}/functions/v1/tools-handler`, {
      method: "POST", 
      headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        businessId: briefcase.businessId, 
        conversationId: briefcase.conversationId, 
        userId: briefcase.userId, 
        media: briefcase.media, 
        toolCalls: formattedTools
      })
    });

    const rawResults = await toolResponse.json();
    // 🔥 ROBUST ARRAY PARSING: Ensures find() doesn't crash if handler returns an object
    const toolResults = Array.isArray(rawResults) ? rawResults : (rawResults.results || [rawResults]);
    const uiDispatches: Promise<any>[] = [];

    for (const tc of formattedTools) {
      const result = toolResults.find((r: any) => r.id === tc.id);
      if (!result) {
        logger.warn("TOOL_EXECUTOR", `No result returned for tool call ID: ${tc.id}`);
        continue;
      }

      let output = result.output;
      
      if (typeof output === 'string') {
        try { output = JSON.parse(output); } 
        catch(e) { briefcase.chefData.push(`[SYSTEM]: ${output}`); continue; }
      }

      if (["search_products", "handle_images", "search_by_image"].includes(tc.name)) {
        let products = Array.isArray(output) ? output : (output?.products || output?.data || output?.silent_data || []);
        
        if (products.length > 0) {
          if (!output?.silent_data) {
            for (const p of products.slice(0, 3)) {
              uiDispatches.push(dispatchOutbound({ 
                type: "product_card", data: p, recipientId: briefcase.userId, businessId: briefcase.businessId, conversationId: briefcase.conversationId 
              }, briefcase, logger));
            }
          }
          briefcase.chefData.push(`[SUCCESS]: Found ${products.length} products. Details: ${JSON.stringify(products)}`);
          logger.info("TOOL_EXECUTOR", `Found ${products.length} products via ${tc.name}`);
        } else {
          briefcase.chefData.push(`[NOTIFY]: Ran ${tc.name} but no direct matches were found in inventory.`);
        }
      } 
      else if (tc.name === "search_knowledge_base") {
        briefcase.librarianFacts.push(JSON.stringify(output));
        briefcase.chefData.push(`[KNOWLEDGE]: ${JSON.stringify(output)}`);
      }
      else {
        briefcase.chefData.push(`[RESULT] ${tc.name}: ${JSON.stringify(output)}`);
      }
    }
    
    await Promise.all(uiDispatches);

    briefcase.thoughts.push({
      agent: "tool_executor",
      tool_calls: formattedTools,
      raw_results: toolResults,
      duration: getTs(start)
    });

    logger.info("TOOL_EXECUTOR", `Tools execution completed in ${getTs(start)}`);
  } catch (e) { 
    briefcase.thoughts.push({ agent: "tool_executor", error: e.message, duration: getTs(start) });
    briefcase.chefData.push(`[ERROR]: Technical glitch during tool execution.`); 
    logger.error("TOOL_EXECUTOR", "Tool execution failed critically", { error: e.message });
  }
}

async function callSopServer(briefcase: SessionBriefcase, query: string, logger: any) {
  const start = performance.now();
  const config = briefcase.prompts;

  const sysPrompt = `
${config.sop_ai_prompt || "You are the Librarian. Search the business SOPs to answer user queries."}
Current Stage: ${briefcase.stage}
`;

  const librarianTools = [{
    type: "function",
    function: {
      name: "search_knowledge_base",
      description: "Search the internal SOP and policy documents.",
      parameters: { type: "object", required: ["query"], properties: { query: { type: "string" } } }
    }
  }];

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini", temperature: 0, tools: librarianTools,
      tool_choice: { type: "function", function: { name: "search_knowledge_base" } },
      messages: [{ role: "system", content: sysPrompt }, { role: "user", content: `Look up the policy for: ${query}` }]
    });

    const toolCall = res.choices[0].message.tool_calls?.[0];
    const args = toolCall ? JSON.parse(toolCall.function.arguments) : { query };

    briefcase.thoughts.push({ agent: "librarian", search_query: args.query, thought: "Searching knowledge base", duration: getTs(start) });
    logger.info("LIBRARIAN", `Searching SOPs for: ${args.query}`);
    
    return [{ name: "search_knowledge_base", args }];
  } catch (e) {
    briefcase.thoughts.push({ agent: "librarian", error: e.message, duration: getTs(start) });
    logger.error("LIBRARIAN", "SOP Server failed", { error: e.message });
    return []; 
  }
}

async function callSalesServer(briefcase: SessionBriefcase, logger: any) {
  const start = performance.now();
  const config = briefcase.prompts;

  // 🔥 ENRICHED CONTEXT: Sales AI now sees Cart and Notes
  const sysPrompt = `
${config.sales_ai_prompt_mechanics || "You are the Sales AI."}

--- CONTEXT ---
Stage: ${briefcase.stage}
Summary: ${briefcase.summary || "None"}
Cart Items: ${JSON.stringify(briefcase.cart || "Empty")}
Contact Notes: ${briefcase.notes || "None"}
EQ Hook: ${briefcase.eqBriefcase?.sales_hook || ""}
Librarian Facts: ${JSON.stringify(briefcase.librarianFacts)}
Tool Results: ${JSON.stringify(briefcase.chefData)}

Remember: Speak naturally. 25 Words Max.
`;

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini", temperature: 0.8, 
      messages: [{ role: "system", content: sysPrompt }, { role: "user", content: briefcase.userText }]
    });
    
    const reply = res.choices[0].message.content || "";
    briefcase.thoughts.push({ agent: "sales_ai", output: reply, duration: getTs(start) });
    logger.info("SALES_AI", `Generated response in ${getTs(start)}`);
    return reply;
  } catch (e) { 
    briefcase.thoughts.push({ agent: "sales_ai", error: e.message, duration: getTs(start) });
    logger.error("SALES_AI", "Sales AI failed", { error: e.message });
    return "System error."; 
  }
}

// --- 6. MAIN ORCHESTRATOR ---
serve(async (req) => {
  const globalStart = performance.now();
  let payload;
  try { payload = await req.json(); } catch (e) { return new Response("Error", { status: 400 }); }

  const { text, history = [], businessId, conversationId, userId, platform = "whatsapp", media, is_simulation = false, action } = payload;

  // Lightweight action router to support the frontend tester UI
  if (action) {
    try {
      if (action === 'fetch_businesses') {
        const biz = await supabase.from('businesses').select('name,business_id');
        return new Response(JSON.stringify({ businesses: biz.data || [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (action === 'fetch_init_data') {
        const bid = businessId;
        const [configRes, bizRes, toolsRes] = await Promise.all([
          supabase.from('global_config').select('*').eq('id', 1).single(),
          supabase.from('businesses').select('*').eq('business_id', bid).maybeSingle(),
          supabase.from('business_tools').select('tools_library!inner(name, description, parameters)').eq('business_id', bid)
        ]);

        const prompts = { ...(configRes.data || {}), ...(bizRes.data || {}) };
        const tools = (toolsRes.data || []).map((r: any) => r.tools_library).filter((t: any) => t !== null);

        return new Response(JSON.stringify({ prompts, business_prompt: bizRes.data?.business_prompt || '', tools }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (action === 'update_prompts') {
        // Expect payload: globalPrompts (object) and businessPrompt (string) and businessId
        const gp = payload.globalPrompts || {};
        const businessPrompt = payload.businessPrompt || '';
        const bid = businessId;

        const tasks: Promise<any>[] = [];
        if (Object.keys(gp).length > 0) {
          tasks.push(supabase.from('global_config').update(gp).eq('id', 1));
        }
        if (bid) {
          tasks.push(supabase.from('businesses').update({ business_prompt: businessPrompt }).eq('business_id', bid));
        }

        const results = await Promise.allSettled(tasks);
        const rejected = results.filter(r => r.status === 'rejected');
        if (rejected.length > 0) {
          return new Response(JSON.stringify({ error: 'Failed to persist prompts' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }
  
  const briefcase: SessionBriefcase = {
    userText: text || "", userId, businessId, conversationId, platform, media, is_simulation,
    summary: "", recentChat: [], prompts: {}, activeTools: [], stage: "GREETING", customerProfile: {},
    cart: null, notes: "", librarianFacts: [], chefData: [], thoughts: [], uiDispatched: false,
    performance_metrics: {}, logs: []
  };

  const logger = createLogger(briefcase);
  logger.info("BOARDROOM", `Session Started. Simulation Mode: ${is_simulation}`, { userInput: briefcase.userText });

  try {
    // 1. FETCH DATA (Now fetching cart and notes from conversations)
    const [bizReq, convReq, msgReq, toolsReq, configReq] = await Promise.all([
      supabase.from("businesses").select("*").eq("business_id", businessId).single(),
      supabase.from("conversations").select("context_summary, stage, cart, notes").eq("id", conversationId).maybeSingle(),
      supabase.from("messages").select("role, content").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(10),
      supabase.from("business_tools").select("tools_library!inner(name, description, parameters)").eq("business_id", businessId),
      supabase.from("global_config").select("*").eq("id", 1).single()
    ]);

    // 2. DATA ASSIGNMENT
    briefcase.prompts = { ...(configReq.data || {}), ...(bizReq.data || {}) };
    briefcase.stage = convReq.data?.stage || "GREETING";
    briefcase.summary = convReq.data?.context_summary || "";
    briefcase.cart = convReq.data?.cart || null;
    briefcase.notes = convReq.data?.notes || "";
    
    if (is_simulation && history.length > 0) {
      // Use the bundled history from the frontend UI
      briefcase.recentChat = history;
    } else {
      // Use the actual database history for live users
      briefcase.recentChat = (msgReq.data || []).reverse().map((m: any) => ({
        role: m.role, content: typeof m.content === 'string' ? m.content : (m.content?.text || "")
      }));
    }

    briefcase.activeTools = (toolsReq.data || [])
      .map((row: any) => row.tools_library).filter((tool: any) => tool !== null);

    // 3. RUN SUMMARIZER
    briefcase.summary = await callSummarizer(briefcase, logger);

    // 4. PARALLEL EXECUTION: EQ + MANAGER
    const eqPromise = callEQAnalyst(briefcase, logger);
    const managerDecision = await callManager(briefcase, logger);
    
    // 5. THE FORK: Execute Tools or Skip
    if (managerDecision.target === "TOOLS" || managerDecision.target === "LIBRARIAN") {
      const highLatencyTools = ["search_products", "handle_images", "search_by_image"];
      const hasLatencyTool = managerDecision.tasks?.some((t: any) => highLatencyTools.includes(t.name));

      if (managerDecision.holding_message && hasLatencyTool) {
        backgroundTasks.push(dispatchOutbound({ 
          type: "text", text: managerDecision.holding_message, recipientId: userId, businessId, conversationId 
        }, briefcase, logger)); 
      }
      
      const tasksToRun = managerDecision.target === "LIBRARIAN" 
        ? await callSopServer(briefcase, briefcase.userText, logger) 
        : (managerDecision.tasks || []);

      await executeTools(briefcase, tasksToRun, logger);
    }

    // 6. SYNC DATA & FINAL SALES REPLY
    briefcase.eqBriefcase = await eqPromise;
    const finalSalesText = await callSalesServer(briefcase, logger);
    
    await dispatchOutbound({ 
      type: "text", text: finalSalesText, recipientId: userId, businessId, conversationId 
    }, briefcase, logger);

    // 7. DB PERSISTENCE
    if (!is_simulation) {
      backgroundTasks.push(
        supabase.from("messages").insert([
          { conversation_id: conversationId, role: 'ai', content: { text: finalSalesText } }
        ]),
        supabase.from("conversations").update({ 
          stage: managerDecision.new_stage || briefcase.stage,
          context_summary: briefcase.summary 
        }).eq("id", conversationId)
      );
    }

    const totalDuration = getTs(globalStart);
    logger.info("BOARDROOM", `Session Closed in ${totalDuration}`);

    // 🔥 JSON RESPONSE: Returning all logs and metadata for the Webhook & UI
    return new Response(JSON.stringify({ 
      status: "success", 
      reply: finalSalesText, 
      duration: totalDuration,
      logs: briefcase.logs,
      feature_one_meta: {
        thoughts: briefcase.thoughts,
        summary: briefcase.summary,
        stage_end: managerDecision.new_stage || briefcase.stage,
        eq_analysis: briefcase.eqBriefcase
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    logger.error("BOARDROOM_CRITICAL", err.stack);
    return new Response(JSON.stringify({ error: err.message, logs: briefcase.logs }), { 
      status: 500, headers: { "Content-Type": "application/json" }
    });
  } finally {
    if (backgroundTasks.length > 0) {
      await Promise.allSettled(backgroundTasks);
    }
  }
});