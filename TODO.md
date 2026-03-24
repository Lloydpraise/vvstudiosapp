import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import OpenAI from "https://esm.sh/openai@4.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- CONFIGURATION ---
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY }); // Kept for embeddings only
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

// --- HELPER 1: Extract Thoughts (SAFETY NET) ---
function processAiThoughts(rawContent: string, toolCalls: any[] | null, nativeReasoning: string | null = null) {
  let cleanText = rawContent || "";
  let thoughts = nativeReasoning || "";

  // 1. Catch explicit <thinking> tags
  const thinkingMatch = cleanText.match(/<thinking>([\s\S]*?)<\/thinking>/i);
  if (thinkingMatch) {
      thoughts += "\n[Tag Thoughts]: " + thinkingMatch[1].trim();
      cleanText = cleanText.replace(/<thinking>[\s\S]*?<\/thinking>/i, '').trim();
  }

  // 2. Catch raw un-tagged prompt leaks (Intent: ... Stage: ...)
  if (cleanText.includes("Intent:") && cleanText.includes("Stage:")) {
      const splitMatch = cleanText.match(/(Hi!|Hello|Hey|Greetings|Sure|I can|Let me|Okay|Great|To get this|Unfortunately)/i);
      
      if (splitMatch && splitMatch.index !== undefined && splitMatch.index > 0) {
          const leakedThoughts = cleanText.substring(0, splitMatch.index).trim();
          thoughts += "\n[Leaked Thoughts]: " + leakedThoughts;
          cleanText = cleanText.substring(splitMatch.index).trim();
      } else {
         const lastBracket = cleanText.lastIndexOf("]");
         if (lastBracket !== -1) {
            const leakedThoughts = cleanText.substring(0, lastBracket + 1).trim();
            thoughts += "\n[Leaked Thoughts]: " + leakedThoughts;
            cleanText = cleanText.substring(lastBracket + 1).trim();
         }
      }
  }

  // 3. Fallback for tool detection
  if (!thoughts && toolCalls && toolCalls.length > 0) {
      const toolNames = toolCalls.map(tc => tc.name).join(", ");
      thoughts = `[System] Auto-detected tool calls: ${toolNames}`;
  }

  // 4. Final scrub
  cleanText = cleanText.replace(/^[\s|]+/, '').trim();

  return { cleanText, thoughts: thoughts.trim() || null };
}

const TOOL_STATUS_MESSAGES: Record<string, string> = {
  search_products: "🔍 Checking our inventory...",
  search_knowledge_base: "📖 Checking our policies...",
  handle_images: "📸 Analyzing your image... please wait.",
  search_by_image: "📸 Analyzing your image...",
  create_shopify_link: "🛒 Generating your secure checkout link...",
  convert_currency: "💱 Calculating exchange rate...",
  check_order_status: "📦 Looking up your order details...",
  escalate_to_agent: "👤 Connecting you to a human agent...",
  ask_for_image: "📸 preparing to receive image...",
  identify_user_market: "🌍 Checking shipping rates...",
  add_to_cart: "🛒 Updating your cart...",
  remove_from_cart: "🗑️ Removing item from cart..."
};

// --- HELPER 2: Outbound Dispatcher ---
async function dispatchOutbound(payload: any, platform: string, simulationLogs?: any[]) {
  if (simulationLogs) {
      if (payload.type === 'product_card') simulationLogs.push({ type: 'product_card', data: payload.data });
      else if (payload.type === 'text') simulationLogs.push({ type: 'text', text: payload.text });
      else if (payload.type === 'checkout_button') simulationLogs.push({ type: 'checkout_button', data: payload.data });
      return; 
  }

  const outboundMap: any = {
    whatsapp: "whatsapp-outbound", facebook: "meta-outbound",
    instagram: "meta-outbound", tiktok: "tiktok-outbound"
  };
  const target = outboundMap[platform];
  if (!target) return;

  try {
    await fetch(`${supabaseUrl}/functions/v1/${target}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error(`[BRAIN] 📤 Dispatch Error (${target}):`, e);
  }
}

// --- HELPER 3: Background Tool Execution (Responses API Architecture) ---
async function executeToolsAndDispatch(
  toolCalls: any[], userId: string, businessId: string, 
  platform: string, conversationId: string, systemPrompt: string, media?: any, simulationLogs?: any[], firstResponseId?: string
) {
  console.log(`\n[BRAIN] ⚙️ BACKGROUND EXECUTION STARTED`);
  
  try {
    if (simulationLogs) {
        toolCalls.forEach((tc: any) => simulationLogs.push({ type: 'tool_call', name: tc.name }));
    }

    const toolResponse = await fetch(`${supabaseUrl}/functions/v1/tools-handler`, {
        method: "POST",
        headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId, conversationId, media, userId,
          toolCalls: toolCalls.map((tc: any) => {
            const args = typeof tc.arguments === 'string' ? JSON.parse(tc.arguments || "{}") : tc.arguments;
            return { id: tc.id, name: tc.name, args: args };
          })
        })
      });

    if (!toolResponse.ok) throw new Error(`Tool Handler Failed: ${await toolResponse.text()}`);
    const toolResults = await toolResponse.json();

    let hasProductCards = false; let isKnowledgeQuery = false; let hasCheckout = false; 
    const functionCallOutputs: any[] = []; // Array to hold GPT-5 formatted outputs

    for (const tc of toolCalls) {
      const result = toolResults.find((r: any) => r.id === tc.id);
      let aiContent = "";

      if (!result) {
          aiContent = `{"status": "error", "message": "Tool execution failed or returned no data."}`;
      } else {
          const toolName = tc.name || "unknown";
          
          if (toolName === "search_products" || toolName === "search_by_image" || toolName === "handle_images") {
              let products = [];
              try {
                const parsed = typeof result.output === "string" ? JSON.parse(result.output) : result.output;
                products = Array.isArray(parsed) ? parsed : (parsed?.products || []);
              } catch {}
              
              if (products.length > 0) {
                  aiContent = `Success: Sent ${products.length} product cards. Matches: ` + products.map((p: any) => `${p.title} (ID: ${p.id})`).join(", ");
                  hasProductCards = true;
                  for (const product of products) {
                    await dispatchOutbound({ type: "product_card", data: product, recipientId: userId, businessId }, platform, simulationLogs);
                    if (!simulationLogs) {
                        const { error: msgErr } = await supabase.from("messages").insert({
                          conversation_id: conversationId, business_id: businessId, direction: "out", role: "ai",
                          content: { type: "product_card", product_id: product.id, title: product.title, price: product.price, image: product.image_url }, status: "sent"
                        });
                        if (msgErr) console.error("[BRAIN] ❌ Outbound Product Card Insert Error:", msgErr);
                    }
                  }
              } else {
                  aiContent = "No products found.";
              }
          } else if (toolName === "take_notes" || toolName === "set_conversation_stage" || toolName === "alert_admin_order") {
              aiContent = `{"status": "success"}`; 
          } else if (toolName === "search_knowledge_base") {
              const raw = typeof result.output === "string" ? result.output : JSON.stringify(result.output);
              aiContent = `Success: Policies retrieved. Data: ${raw.substring(0, 400)}`; 
              isKnowledgeQuery = true;
          } else if (toolName === "create_shopify_link") {
              hasCheckout = true;
              const rawOutput = typeof result.output === "string" ? result.output : JSON.stringify(result.output);
              const jsonMatch = rawOutput.match(/\{"type":\s*"checkout_button",\s*"url":\s*"(.*?)"\}/);
              
              if (jsonMatch) {
                  const checkoutUrl = jsonMatch[1];
                  await dispatchOutbound({ type: "checkout_button", data: { url: checkoutUrl }, recipientId: userId, businessId }, platform, simulationLogs);
                  if (!simulationLogs) {
                      await supabase.from("messages").insert({
                          conversation_id: conversationId, business_id: businessId, direction: "out", role: "ai",
                          content: { text: "🛍️ I've generated your secure checkout button below." }, status: "sent"
                      });
                  }
              }
          } else {
              aiContent = typeof result.output === "string" ? result.output.substring(0, 800) : JSON.stringify(result.output).substring(0, 800);
          }
      }

      // Format exactly as GPT-5 expects
      functionCallOutputs.push({
          type: "function_call_output",
          call_id: tc.id,
          output: aiContent
      });
    }

    let finalSystemInstruction = `Briefly summarize the action taken (Under 20 words).`;
    if (hasCheckout) finalSystemInstruction = `You generated a checkout button. Tell user to tap the button above to complete purchase. NO URLs. Max 20 words.`;
    else if (isKnowledgeQuery) finalSystemInstruction = `Answer the user comprehensively using the Knowledge Base data. Be friendly but precise.`;
    else if (hasProductCards) finalSystemInstruction = `CRITICAL PROTOCOL: Visual product cards were sent. DO NOT list product names/links. ONLY say: "Here are the best matches I found! Tap 'Buy Now' on your favorite." Max 25 words. Focus purely on closing the sale.`;

    console.log(`\n[BRAIN] 🧠 Executing Second Pass GPT-5-mini payload`);
    
    // Pass previous_response_id instead of message history
    const secondPassRes = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "gpt-5-mini-2025-08-07",
            previous_response_id: firstResponseId,
            input: [
              { role: "developer", content: `# Immediate Task\n${finalSystemInstruction}` },
              ...functionCallOutputs
            ],
            reasoning: { effort: "low" },
            text: { verbosity: "low" }
        })
    });

    const secondPassData = await secondPassRes.json();
    const secondMsgBlock = secondPassData.output?.find((item: any) => item.type === "message");
    const secondReasoningBlock = secondPassData.output?.find((item: any) => item.type === "reasoning");

    let rawFinalReply = secondMsgBlock?.content?.find((c: any) => c.type === "output_text")?.text || "Processing complete. How else can I help you?";
    const { cleanText: finalCleanReply, thoughts: finalThoughts } = processAiThoughts(rawFinalReply, null, secondReasoningBlock?.text || null);
    
    if (simulationLogs && finalThoughts) {
        simulationLogs.push({ type: 'thought', text: finalThoughts });
    }

    if (finalThoughts && !simulationLogs) {
        supabase.from("thinking_logs").insert({
            business_id: businessId, conversation_id: conversationId,
            user_message: "[Post-Tool Action]", thinking_process: finalThoughts, ai_response: finalCleanReply
        }).then(({ error }) => {
            if (error) console.error("[BRAIN] ❌ Post-Tool Thinking Log Error:", error);
        }); 
     }
    
    if (!simulationLogs) {
        await supabase.from("messages").insert({
            conversation_id: conversationId, business_id: businessId, direction: "out", role: "ai",
            content: { text: finalCleanReply }, status: "sent"
        });
    }
    
    await dispatchOutbound({ type: "text", text: finalCleanReply, recipientId: userId, businessId }, platform, simulationLogs).catch(console.error);
    console.log(`\n[BRAIN] ✅ BACKGROUND EXECUTION COMPLETED`);

  } catch (err) {
    console.error(`\n[BRAIN] 💥 BACKGROUND TASK FATAL ERROR:`, err);
  }
}

// --- HELPER 4: Auto-Summarization ---
async function summarizeConversationIfNeeded(conversationId: string, businessId: string) {
  try {
    const { count, error } = await supabase.from("messages").select("*", { count: "exact", head: true }).eq("conversation_id", conversationId);
    if (error || !count || count % 10 !== 0) return; 

    const { data: recentMessages } = await supabase.from("messages").select("role, content").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(10);
    if (!recentMessages || recentMessages.length === 0) return;

    const chatText = recentMessages.reverse().map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join("\n");
    
    const summaryRes = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "gpt-5-mini-2025-08-07",
            input: [
                { role: "developer", content: "Summarize this chat chunk in 2-3 sentences. Focus on user intent, preferences, and current state of request." },
                { role: "user", content: chatText }
            ],
            reasoning: { effort: "low" },
            text: { verbosity: "low" }
        })
    });

    const summaryData = await summaryRes.json();
    const msgBlock = summaryData.output?.find((item: any) => item.type === "message");
    const summary = msgBlock?.content?.find((c: any) => c.type === "output_text")?.text;

    if (!summary) return;

    const embRes = await openai.embeddings.create({ model: "text-embedding-3-small", input: summary });
    await supabase.from("conversation_summaries").insert({ conversation_id: conversationId, business_id: businessId, summary: summary, embedding: embRes.data[0].embedding });
    
  } catch (err) {
    console.error("[BRAIN] ❌ Summarization Error:", err);
  }
}

// --- MAIN HANDLER ---
serve(async (req) => {
  let fallbackPayload: any = null;
  let fallbackPhone = "our team";
  let fallbackWebsite = "our site";

  try {
    const payload = await req.json();
    fallbackPayload = payload; 
    
    const rawText = payload.text || payload.userText || "";
    const { userId, businessId, platform, conversationId, context, media, is_simulation, overrides, history: simHistory } = payload;

    let queryEmbedding = [];
    if (rawText.trim().length > 0) {
        try {
            const embRes = await openai.embeddings.create({ model: "text-embedding-3-small", input: rawText });
            queryEmbedding = embRes.data[0].embedding;
        } catch (e) {}
    }

    const [globalReq, bizReq, histReq, toolsReq, convReq, platformReq, notesReq, summariesReq] = await Promise.all([
      supabase.from("global_config").select("master_system_prompt").eq("id", 1).single(),
      supabase.from("businesses").select("*").eq("business_id", businessId).single(),
      supabase.from("messages").select("role, content").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(10),
      supabase.from("business_tools").select("tool_id, tools_library(name, description, parameters)").eq("business_id", businessId),
      supabase.from("conversations").select("stage, cart_state").eq("id", conversationId).single(),
      supabase.from("platform_rules").select("instruction").eq("platform", platform).maybeSingle(),
      queryEmbedding.length > 0 ? supabase.rpc("match_customer_notes", { query_embedding: queryEmbedding, match_threshold: 0.3, match_count: 3, p_user_id: userId, p_business_id: businessId }) : Promise.resolve({ data: [] }),
      queryEmbedding.length > 0 ? supabase.rpc("match_conversation_summaries", { query_embedding: queryEmbedding, match_threshold: 0.3, match_count: 3, p_conversation_id: conversationId, p_business_id: businessId }) : Promise.resolve({ data: [] })
    ]);

    if (bizReq.data) {
        fallbackPhone = bizReq.data.phone || fallbackPhone;
        fallbackWebsite = bizReq.data.website_url || fallbackWebsite;
    }

    const currentDateTime = new Date().toLocaleString("en-US", { timeZone: bizReq.data?.timezone || "UTC" });
    const activeLessons = bizReq.data?.active_ai_lessons || "Continue adapting to the user's needs.";
    
    const masterPromptConfig = overrides?.global || globalReq.data?.master_system_prompt || "You are an expert AI Sales Assistant.";
    const bizNotesConfig = overrides?.business || bizReq.data?.system_prompt || bizReq.data?.notes || "No extra notes.";
    const platformRulesConfig = overrides?.platform || platformReq.data?.instruction || "- Respond naturally for this platform.";
    
    const relevantNotes = notesReq.data?.map((n: any) => n.note).join(" | ") || "No specific customer facts found.";
    const relevantSummaries = summariesReq.data?.map((s: any) => s.summary).join(" | ") || "No relevant past context found.";

    const finalSystemMessage = `
${masterPromptConfig}

# Business Context
- Business Name: ${bizReq.data?.name || "Unknown"}
- Currency: ${bizReq.data?.currency || "KES"}
- Website: ${bizReq.data?.website_url || "Unknown"}
- Platform Rules (${platform}): ${platformRulesConfig}

# Additional Business Notes/Prompts
${bizNotesConfig}

# AI Lessons Learned
${activeLessons}
`.trim();

    const dynamicBottom = `
[SYSTEM CONTEXT INJECTION]
- Current Date/Time: ${currentDateTime}
- User/Customer Name: ${context?.name || "Customer"}
- Funnel Stage: ${convReq.data?.stage || "browsing"}
- Current Cart: ${JSON.stringify(convReq.data?.cart_state || [])}
- Known Customer Facts: ${relevantNotes}
- Relevant Past Conversation Context: ${relevantSummaries}
`;

    let history = [];
    if (is_simulation && simHistory) {
        history = simHistory;
    } else {
        history = (histReq.data || []).reverse()
          .map((m: any) => ({
            role: (m.role === "ai" || m.role === "assistant") ? "assistant" : "user",
            content: typeof m.content === "string" ? m.content : (m.content?.text || "[Media]")
          }))
          .filter((m: any) => m.content.trim().length > 0);
    }

    const messages: any[] = [
      { role: "developer", content: finalSystemMessage }, 
      ...history,
      { role: "user", content: rawText } 
    ];

    let systemMediaFlag = "[SYSTEM FLAG: NO IMAGE ATTACHED. Do not call handle_images]";

    if (media) {
      const finalImageUrl = media.url || 
                             (media.base64 ? `data:${media.type || 'image/jpeg'};base64,${media.base64}` : null) ||
                             (media.data ? `data:${media.type || 'image/jpeg'};base64,${media.data}` : null);
      if (finalImageUrl) {
          systemMediaFlag = "[SYSTEM FLAG: USER ATTACHED AN IMAGE. YOU MUST CALL handle_images TO ANALYZE IT]";
          messages[messages.length - 1] = {
            role: "user",
            content: [ 
                { 
                  type: "input_text", 
                  text: `${dynamicBottom}\n\n${systemMediaFlag}\n\nUser Text: ${rawText || "I'm looking for this product."}` 
                }, 
                { 
                  type: "input_image", 
                  image_url: finalImageUrl,
                  detail: "auto" 
                } 
            ]
          };
      } else {
          messages[messages.length - 1].content = `${dynamicBottom}\n\n${systemMediaFlag}\n\nUser Text: ${rawText}`;
      }
    } else {
         messages[messages.length - 1].content = `${dynamicBottom}\n\n${systemMediaFlag}\n\nUser Text: ${rawText}`;
    }

    // ✅ FIXED: Flattened tool structure with Strict Mode and Schema Enforcement
    const activeTools = toolsReq.data?.map((row: any) => {
      let safeParams = row.tools_library.parameters || {};
      
      // GPT-5 Strict Mode requires additionalProperties to be explicitly false
      if (safeParams.type === "object") {
          safeParams.additionalProperties = false;
      }

      return {
        type: "function",
        name: row.tools_library.name, 
        description: row.tools_library.description, 
        strict: true, // MANDATORY for reliable GPT-5 Responses API tool calling
        parameters: safeParams
      };
    }) || [];

    console.log(`\n[BRAIN] 🤖 Executing First Pass GPT-5-mini payload`);
    
    const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "gpt-5-mini-2025-08-07",
            input: messages,
            tools: activeTools.length ? activeTools : undefined,
            reasoning: { effort: "low" },
            text: { verbosity: "low" }
        })
    });

    if (!openAIResponse.ok) {
        throw new Error(`OpenAI API failed: ${await openAIResponse.text()}`);
    }

    const data = await openAIResponse.json();
    
    // 🚨 RAW DEBUGGER: Let's see exactly what GPT-5 sent back
    console.log("\n[BRAIN] 🚨 RAW OPENAI OUTPUT DUMP:\n", JSON.stringify(data.output, null, 2));
    
    // --- CORRECTED EXTRACTION LOGIC ---
    const reasoningItem = data.output?.find((i: any) => i.type === "reasoning");
    const nativeReasoning = reasoningItem?.text || null;

    const messageItem = data.output?.find((i: any) => i.type === "message");
    // Ensure we handle either "text" or "output_text" based on variation
    const rawContent = messageItem?.content?.find((c: any) => c.type === "text" || c.type === "output_text")?.text || "";

    const toolCalls = data.output
        ?.filter((i: any) => i.type === "function_call")
        .map((tc: any) => ({
            id: tc.call_id,      
            name: tc.name,        
            arguments: tc.arguments 
        })) || [];
    // --- END EXTRACTION LOGIC ---

    const { cleanText, thoughts } = processAiThoughts(rawContent, toolCalls, nativeReasoning);
    
    const simulationLogs: any[] = [];
    if (is_simulation && thoughts) {
        simulationLogs.push({ type: 'thought', text: thoughts });
    }

    if (thoughts && !is_simulation) {
        supabase.from("thinking_logs").insert({
            business_id: businessId, conversation_id: conversationId,
            user_message: rawText, thinking_process: thoughts, ai_response: cleanText
        }).then(({ error }) => {
            if (error) console.error("\n[BRAIN] ❌ Main Thinking Log Error:", error);
        });
    }

    if (!toolCalls?.length) {
      if (is_simulation) {
          if (cleanText) {
              simulationLogs.push({ type: 'text', text: cleanText });
          }
          return new Response(JSON.stringify({ events: simulationLogs }));
      }

      await Promise.all([
        dispatchOutbound({ type: "text", text: cleanText, recipientId: userId, businessId }, platform),
        supabase.from("messages").insert({
            conversation_id: conversationId, business_id: businessId, direction: "out", role: "ai", 
            content: { text: cleanText }, status: "sent"
        }).then(({ error }) => {
            if (error) console.error("\n[BRAIN] ❌ Outbound Direct Text Insert Error:", error);
        })
      ]);
      
      if (!is_simulation) {
          // @ts-ignore
          if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(summarizeConversationIfNeeded(conversationId, businessId));
      }
      
      if (platform === "facebook" || platform === "instagram") {
          return new Response(JSON.stringify({ version: "v2", content: { messages: [] } }));
      }
      return new Response(JSON.stringify({ reply: cleanText }));
    }

    const statusMsg = TOOL_STATUS_MESSAGES[toolCalls[0].name];

    if (is_simulation) {
        if (statusMsg) simulationLogs.push({ type: 'text', text: statusMsg });
        
        // Pass data.id as previous_response_id
        await executeToolsAndDispatch(toolCalls, userId, businessId, platform, conversationId, finalSystemMessage, media, simulationLogs, data.id);
        return new Response(JSON.stringify({ events: simulationLogs }));
    }

    // Background execution for live
    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(executeToolsAndDispatch(toolCalls, userId, businessId, platform, conversationId, finalSystemMessage, media, undefined, data.id));
    else executeToolsAndDispatch(toolCalls, userId, businessId, platform, conversationId, finalSystemMessage, media, undefined, data.id);

    if (!is_simulation) {
        // @ts-ignore
        if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(summarizeConversationIfNeeded(conversationId, businessId));
    }

    if (platform === "facebook" || platform === "instagram") {
        return new Response(JSON.stringify({ 
            version: "v2", 
            content: { messages: [{ type: "text", text: statusMsg || "Processing..." }] } 
        }));
    }

    if (statusMsg) {
        await dispatchOutbound({ type: "text", text: statusMsg, recipientId: userId, businessId }, platform).catch(console.error);
    }
    
    return new Response(JSON.stringify({ status: "processing" }));

  } catch (err: any) {
    console.error(`\n[BRAIN] 💀 FATAL HANDLER ERROR:`, err.message);
    
    const fallbackMsg = `AI is currently unavailable. Contact ${fallbackPhone} or visit ${fallbackWebsite}.`;

    if (fallbackPayload?.is_simulation) {
        return new Response(JSON.stringify({ error: err.message, fallback_sent: true }), { status: 200 });
    }

    try {
      if (fallbackPayload?.conversationId) {
        await supabase.from("messages").insert({
          conversation_id: fallbackPayload.conversationId,
          business_id: fallbackPayload.businessId,
          direction: "out", role: "ai", 
          content: { text: fallbackMsg, error_log: err.message }, status: "sent"
        });
      }
    } catch (logErr) {
      console.error("\n[BRAIN] 🚨 Logging failed:", logErr);
    }

    if (fallbackPayload?.platform === "facebook" || fallbackPayload?.platform === "instagram") {
      return new Response(JSON.stringify({ version: "v2", content: { messages: [{ type: "text", text: fallbackMsg }] } }), { status: 200 });
    }

    if (fallbackPayload?.userId && fallbackPayload?.businessId) {
      await dispatchOutbound({ type: "text", text: fallbackMsg, recipientId: fallbackPayload.userId, businessId: fallbackPayload.businessId }, fallbackPayload.platform).catch(() => {});
    }

    return new Response(JSON.stringify({ error: "service_unavailable", fallback_sent: true }), { status: 200 });
  }
});


# CHAT COMPLETION OLDER CODE; 

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import OpenAI from "https://esm.sh/openai@4.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- CONFIGURATION ---
const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY") });
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

// --- HELPER 1: Extract Thinking Tags ---
function processAiThoughts(rawContent, toolCalls = null) {
  if (!rawContent && !toolCalls) return { cleanText: "", thoughts: null };
  
  const match = rawContent ? rawContent.match(/<thinking>([\s\S]*?)<\/thinking>/i) : null;
  let thoughts = match ? match[1].trim() : null;
  const cleanText = rawContent ? rawContent.replace(/<thinking>[\s\S]*?<\/thinking>/i, '').trim() : "";
  
  if (!thoughts && toolCalls && toolCalls.length > 0) {
      const toolNames = toolCalls.map(tc => tc.function.name).join(", ");
      thoughts = `[Skipped thinking tags] System auto-detected tool calls: ${toolNames}`;
  }
  
  return { cleanText, thoughts };
}

const TOOL_STATUS_MESSAGES: Record<string, string> = {
  search_products: "🔍 Checking our inventory...",
  search_knowledge_base: "📖 Checking our policies...",
  handle_images: "📸 Checking available products... this may take about 1 minute.",
  search_by_image: "📸 Analyzing your image...",
  create_shopify_link: "🛒 Generating your secure checkout link...",
  convert_currency: "💱 Calculating exchange rate...",
  check_order_status: "📦 Looking up your order details...",
  escalate_to_agent: "👤 Connecting you to a human agent...",
  ask_for_image: "📸 preparing to receive image...",
  identify_user_market: "🌍 Checking shipping rates...",
  add_to_cart: "🛒 Updating your cart...",
  remove_from_cart: "🗑️ Removing item from cart..."
};

// --- HELPER 2: Outbound Dispatcher ---
async function dispatchOutbound(payload: any, platform: string, simulationLogs?: any[]) {
  if (simulationLogs) {
      if (payload.type === 'product_card') simulationLogs.push({ type: 'product_card', data: payload.data });
      else if (payload.type === 'text') simulationLogs.push({ type: 'text', text: payload.text });
      else if (payload.type === 'checkout_button') simulationLogs.push({ type: 'checkout_button', data: payload.data });
      return; 
  }

  const outboundMap: any = {
    whatsapp: "whatsapp-outbound", facebook: "meta-outbound",
    instagram: "meta-outbound", tiktok: "tiktok-outbound"
  };
  const target = outboundMap[platform];
  if (!target) return;

  try {
    await fetch(`${supabaseUrl}/functions/v1/${target}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error(`[BRAIN] 📤 Dispatch Error (${target}):`, e);
  }
}

// --- HELPER 3: Background Tool Execution ---
async function executeToolsAndDispatch(
  toolCalls: any[], messages: any[], userId: string, businessId: string, 
  platform: string, conversationId: string, systemPrompt: string, media?: any, simulationLogs?: any[]
) {
  console.log(`\n[BRAIN] ⚙️ BACKGROUND EXECUTION STARTED`);
  console.log(`[BRAIN] 🛠️ Active Tool Calls:`, toolCalls.map(tc => tc.function.name).join(", "));

  try {
    if (simulationLogs) {
        toolCalls.forEach((tc: any) => simulationLogs.push({ type: 'tool_call', name: tc.function.name }));
    }

    const toolResponse = await fetch(`${supabaseUrl}/functions/v1/tools-handler`, {
        method: "POST",
        headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId, conversationId, media, userId,
          toolCalls: toolCalls.map((tc: any) => {
            let safeArgs = {};
            try { safeArgs = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments || "{}") : tc.function.arguments; } catch (e) {}
            return { id: tc.id, name: tc.function.name, args: safeArgs };
          })
        })
      });

    if (!toolResponse.ok) throw new Error(`Tool Handler Failed: ${await toolResponse.text()}`);
    const toolResults = await toolResponse.json();
    
    console.log(`\n[BRAIN] 📥 TOOL RESULTS RECEIVED`);

    let hasProductCards = false; let isKnowledgeQuery = false; let hasCheckout = false; 

    for (const tc of toolCalls) {
      const result = toolResults.find((r: any) => r.id === tc.id);
      const toolName = tc.function.name || "unknown";
      let aiContent = "";

      if (!result) {
          console.warn(`[BRAIN] ⚠️ Missing result for tool: ${toolName} (${tc.id})`);
          aiContent = `{"status": "error", "message": "Tool execution failed or returned no data."}`;
      } else {
          if (toolName === "search_products" || toolName === "search_by_image" || toolName === "handle_images") {
              let products = [];
              try {
                const parsed = typeof result.output === "string" ? JSON.parse(result.output) : result.output;
                products = Array.isArray(parsed) ? parsed : (parsed?.products || []);
              } catch {}
              
              if (products.length > 0) {
                  aiContent = `Success: Sent ${products.length} product cards. Matches: ` + products.map((p: any) => `${p.title} (ID: ${p.id})`).join(", ");
              } else {
                  aiContent = "No products found.";
              }
          } else if (toolName === "take_notes" || toolName === "set_conversation_stage" || toolName === "alert_admin_order") {
              aiContent = `{"status": "success"}`; 
          } else if (toolName === "search_knowledge_base") {
              const raw = typeof result.output === "string" ? result.output : JSON.stringify(result.output);
              aiContent = `Success: Policies retrieved. Data: ${raw.substring(0, 400)}`; 
          } else {
              aiContent = typeof result.output === "string" ? result.output.substring(0, 400) : JSON.stringify(result.output).substring(0, 400);
          }

          if (toolName === "search_products" || toolName === "search_by_image" || toolName === "handle_images") {
            let products = [];
            try {
              const parsed = typeof result.output === "string" ? JSON.parse(result.output) : result.output;
              products = Array.isArray(parsed) ? parsed : (parsed?.products || []);
            } catch {}

            if (products.length > 0) {
              hasProductCards = true;
              for (const product of products) {
                dispatchOutbound({ type: "product_card", data: product, recipientId: userId, businessId }, platform, simulationLogs).catch(console.error);
                if (!simulationLogs) {
                    const { error: msgErr } = await supabase.from("messages").insert({
                      conversation_id: conversationId, business_id: businessId, direction: "out", role: "ai",
                      content: { type: "product_card", product_id: product.id, title: product.title, price: product.price, image: product.image_url }, status: "sent"
                    });
                    if (msgErr) console.error("[BRAIN] ❌ Outbound Product Card Insert Error:", msgErr);
                }
              }
            }
          }

          if (toolName === "search_knowledge_base") isKnowledgeQuery = true;

          if (toolName === "create_shopify_link") {
              hasCheckout = true;
              const rawOutput = typeof result.output === "string" ? result.output : JSON.stringify(result.output);
              const jsonMatch = rawOutput.match(/\{"type":\s*"checkout_button",\s*"url":\s*"(.*?)"\}/);
              
              if (jsonMatch) {
                  const checkoutUrl = jsonMatch[1];
                  await dispatchOutbound({ type: "checkout_button", data: { url: checkoutUrl }, recipientId: userId, businessId }, platform, simulationLogs).catch(console.error);
                  if (!simulationLogs) {
                      const { error: chkErr } = await supabase.from("messages").insert({
                          conversation_id: conversationId, business_id: businessId, direction: "out", role: "ai",
                          content: { text: "🛍️ I've generated your secure checkout button below." }, status: "sent"
                      });
                      if (chkErr) console.error("[BRAIN] ❌ Checkout Message Insert Error:", chkErr);
                  }
              }
          }
      }

      messages.push({ role: "tool", tool_call_id: tc.id, content: aiContent });
    }

    let finalSystemInstruction = `Briefly summarize the action taken (Under 20 words).`;
    if (hasCheckout) finalSystemInstruction = `You generated a checkout button. Tell user to tap the button above to complete purchase. NO URLs. Max 20 words.`;
    else if (isKnowledgeQuery) finalSystemInstruction = `Answer the user comprehensively using the Knowledge Base data. Be friendly but precise.`;
    else if (hasProductCards) finalSystemInstruction = `CRITICAL PROTOCOL: Visual product cards were sent. DO NOT list product names/links. ONLY say: "Here are the best matches I found! Tap 'Buy Now' on your favorite." Max 25 words. Focus purely on closing the sale.`;

    const secondPassMessages = [
      { role: "system", content: `${systemPrompt}\n\n# Immediate Task\n${finalSystemInstruction}` },
      ...messages.filter(m => m.role !== "system").map(m => {
          const safeMsg: any = { role: m.role, content: m.content ?? "" };
          if (m.tool_calls) safeMsg.tool_calls = m.tool_calls;
          if (m.tool_call_id) safeMsg.tool_call_id = m.tool_call_id;
          if (m.name) safeMsg.name = m.name;
          return safeMsg;
      })
    ];

    console.log(`\n[BRAIN] 🧠 Executing Second Pass GPT-4o-mini payload`);
    
    let secondRun;
    try {
        secondRun = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: secondPassMessages as any
        });
    } catch (openAiErr: any) {
        console.error(`[BRAIN] ❌ Second Pass OpenAI Error:`, openAiErr.message);
        throw openAiErr;
    }

    let rawFinalReply = secondRun.choices[0].message.content || "Use the buy now link or Add to Cart button to proceed with the purchase. If wrong match, simply say wrong match.";
    const { cleanText: finalCleanReply, thoughts: finalThoughts } = processAiThoughts(rawFinalReply);
    
    if (finalThoughts && !simulationLogs) {
        supabase.from("thinking_logs").insert({
            business_id: businessId, conversation_id: conversationId,
            user_message: "[Post-Tool Action]", thinking_process: finalThoughts, ai_response: finalCleanReply
        }).then(({ error }) => {
            if (error) console.error("[BRAIN] ❌ Post-Tool Thinking Log Error:", error);
            else console.log("[BRAIN] ✅ Post-Tool Thinking Log Saved Backgrounded");
        }); 
     }
    
    if (!simulationLogs) {
        const { error: finErr } = await supabase.from("messages").insert({
            conversation_id: conversationId, business_id: businessId, direction: "out", role: "ai",
            content: { text: finalCleanReply }, status: "sent"
        });
        if (finErr) console.error("[BRAIN] ❌ Final Message Insert Error:", finErr);
    }
    
    await dispatchOutbound({ type: "text", text: finalCleanReply, recipientId: userId, businessId }, platform, simulationLogs).catch(console.error);

    console.log(`\n[BRAIN] ✅ BACKGROUND EXECUTION COMPLETED`);

  } catch (err) {
    console.error(`\n[BRAIN] 💥 BACKGROUND TASK FATAL ERROR:`, err);
  }
}

// --- HELPER 4: Auto-Summarization ---
async function summarizeConversationIfNeeded(conversationId: string, businessId: string) {
  try {
    const { count, error } = await supabase.from("messages").select("*", { count: "exact", head: true }).eq("conversation_id", conversationId);
    if (error || !count || count % 10 !== 0) return; 

    const { data: recentMessages } = await supabase.from("messages").select("role, content").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(10);
    if (!recentMessages || recentMessages.length === 0) return;

    const chatText = recentMessages.reverse().map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join("\n");
    const summaryRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Summarize this chat chunk in 2-3 sentences. Focus on user intent, preferences, and current state of request." }, 
        { role: "user", content: chatText }
      ]
    });

    const summary = summaryRes.choices[0].message.content;
    if (!summary) return;

    const embRes = await openai.embeddings.create({ model: "text-embedding-3-small", input: summary });
    await supabase.from("conversation_summaries").insert({ conversation_id: conversationId, business_id: businessId, summary: summary, embedding: embRes.data[0].embedding });
    
  } catch (err) {
    console.error("[BRAIN] ❌ Summarization Error:", err);
  }
}

// --- MAIN HANDLER ---
serve(async (req) => {
  let fallbackPayload: any = null;
  let fallbackPhone = "our team";
  let fallbackWebsite = "our site";

  try {
    const payload = await req.json();
    fallbackPayload = payload; 
    
    const rawText = payload.text || payload.userText || "";
    const { userId, businessId, platform, conversationId, context, media, is_simulation, overrides, history: simHistory } = payload;

    let queryEmbedding = [];
    if (rawText.trim().length > 0) {
        try {
            const embRes = await openai.embeddings.create({ model: "text-embedding-3-small", input: rawText });
            queryEmbedding = embRes.data[0].embedding;
        } catch (e) {}
    }

    const [globalReq, bizReq, histReq, toolsReq, convReq, platformReq, notesReq, summariesReq] = await Promise.all([
      supabase.from("global_config").select("master_system_prompt").eq("id", 1).single(),
      supabase.from("businesses").select("*").eq("business_id", businessId).single(),
      supabase.from("messages").select("role, content").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(10),
      supabase.from("business_tools").select("tool_id, tools_library(name, description, parameters)").eq("business_id", businessId),
      supabase.from("conversations").select("stage, cart_state").eq("id", conversationId).single(),
      supabase.from("platform_rules").select("instruction").eq("platform", platform).maybeSingle(),
      queryEmbedding.length > 0 ? supabase.rpc("match_customer_notes", { query_embedding: queryEmbedding, match_threshold: 0.3, match_count: 3, p_user_id: userId, p_business_id: businessId }) : Promise.resolve({ data: [] }),
      queryEmbedding.length > 0 ? supabase.rpc("match_conversation_summaries", { query_embedding: queryEmbedding, match_threshold: 0.3, match_count: 3, p_conversation_id: conversationId, p_business_id: businessId }) : Promise.resolve({ data: [] })
    ]);

    if (bizReq.data) {
        fallbackPhone = bizReq.data.phone || fallbackPhone;
        fallbackWebsite = bizReq.data.website_url || fallbackWebsite;
    }

    const currentDateTime = new Date().toLocaleString("en-US", { timeZone: bizReq.data?.timezone || "UTC" });
    const activeLessons = bizReq.data?.active_ai_lessons || "Continue adapting to the user's needs.";
    const masterPromptConfig = overrides?.global || globalReq.data?.master_system_prompt || "You are an expert AI Sales Assistant.";
    const bizNotesConfig = overrides?.business || bizReq.data?.system_prompt || bizReq.data?.notes || "No extra notes.";
    const platformRulesConfig = overrides?.platform || platformReq.data?.instruction || "- Respond naturally for this platform.";
    
    const relevantNotes = notesReq.data?.map((n: any) => n.note).join(" | ") || "No specific customer facts found.";
    const relevantSummaries = summariesReq.data?.map((s: any) => s.summary).join(" | ") || "No relevant past context found.";

    const staticTop = `
# Core Identity & Rules
${masterPromptConfig}

# Platform Constraints (${platform})
${platformRulesConfig}

# CRITICAL RULE: INTERNAL MONOLOGUE
Before every single response AND BEFORE triggering any tools, you MUST output a brief internal analysis wrapped in <thinking> tags. If you fail to output the <thinking> block before a tool call, the system will crash.
1. INTENT: Vague, Specific, or Objection?
2. STAGE: What stage is the user in and what does it entail? Did the user provide new info (email/phone)? (Stages: BROWSING, QUALIFYING, PROPOSING, CLOSING, COMPLETED)
3. MEMORY: Scan last 5 messages and facts. Is any needed for this response? 
4. OBJECTION: If price/trust issue, apply "Value First" logic.
5. TOOL CHECK: Which tools am I about to call?
6. Have I followed the given instructions?
Example: <thinking>Intent: Specific product. Action: Need to call search_products for black beadwork. Tool: search_products.</thinking>

# CRITICAL EXECUTION PROTOCOLS (MANDATORY)
1. VISUAL SEARCH: Only call 'handle_images' if the system flag specifically says an image was attached. Ignore the word "image" in regular text.
2. STATE MANAGEMENT: You MUST call 'set_conversation_stage' whenever the user intent shifts (e.g., from asking questions to wanting to see products or to adding a cart).
3. PRODUCT SEARCH (MANDATORY TOOL CALL): When a user asks for recommendations, alternatives, or describes a product (e.g., "black and white sandals"), you MUST call the 'search_products' tool IMMEDIATELY. NEVER tell the user "Please hold on" or "Let me check" without simultaneously calling the tool. If what they said about the product is vague or returns zero results, ask for an screenshot politely.
4. CART & CHECKOUT FLOW (STRICT GUARDRAILS):
   - TRIGGER: Call 'add_to_cart' immediately when a user says "I'll take this", confirms a size, or you receive a 'buy_id' payload.
   - NEGATIVE CONSTRAINT: DO NOT call 'add_to_cart' based on past messages in the history. Only trigger it if the *most recent* user message confirms a size or purchase intent. Do NOT trigger if the user is asking to look for other items. Never print product ids on the customer response. 
   - NO DUPLICATES: Always check the 'Current Cart' state; do not add the same item twice.
   - UNIFIED ACTION: As soon as the cart is updated, DO NOT WAIT. Immediately transition by saying: "Great choice! To get this processed for you, I just need your name, phone number, and delivery location (City/Area)."
   - UNIVERSAL: Apply this flow to ALL users regardless of location.
5. CLOSING THE SALE:
   - Once you have the Name, Phone, and Location:
     1. Call 'alert_admin_order' (to log the customer details for the team).
     2. Call 'create_shopify_link' using the 'product_id' and 'size'.
     3. FINAL STEP: When the system returns the checkout JSON, simply tell the user: "Order details received! Please tap the 'Complete Purchase' button below to pay securely and finalize your delivery."
   - DO NOT print the raw URL; the system will handle the native button display.
6. NO MATCHES: If  handle_images search for products yields nothing, say this 'Seems I can't find the exact product on the website Try sending a clearer image/ send your screenshot to the agent in the shop directly. You can contact them here 254727398075"
7. CUSTOMER FRUSTRATION: If customer is frustrated, has done something repeatedly and you dont seem to know how to answer them , politely ask them to contact the agent through 254727398075 by WhatsApp call/text and then escalate and stop the chat.
`;

    const businessStable = `
# Business Context
- Business Name: ${bizReq.data?.name}
- Currency: ${bizReq.data?.currency || "KES"}
- Website: ${bizReq.data?.website_url}
- Specific Business Notes/Prompts: ${bizNotesConfig}

# AI Lessons Learned (Continuous Improvement)
${activeLessons}
`;

    const dynamicBottom = `
# Immediate Context (Changes per message)
- Current Date/Time: ${currentDateTime}
- User/Customer Name: ${context?.name || "Customer"}
- Funnel Stage: ${convReq.data?.stage || "browsing"}
- Current Cart: ${JSON.stringify(convReq.data?.cart_state || [])}

# Memory & Context (Retrieved via RAG)
- Known Customer Facts: ${relevantNotes}
- Relevant Past Conversation Context: ${relevantSummaries}
`;

    const finalSystemMessage = `${staticTop}\n\n${businessStable}\n\n${dynamicBottom}`;

    let history = [];
    if (is_simulation && simHistory) {
        history = simHistory;
    } else {
        history = (histReq.data || []).reverse()
          .map((m: any) => ({
            role: (m.role === "ai" || m.role === "assistant") ? "assistant" : "user",
            content: typeof m.content === "string" ? m.content : (m.content?.text || "[Media]")
          }))
          .filter((m: any) => m.content.trim().length > 0);
    }

    const messages: any[] = [
      { role: "system", content: finalSystemMessage }, 
      ...history,
      { role: "user", content: rawText }
    ];

    let systemMediaFlag = "[SYSTEM FLAG: NO IMAGE ATTACHED. Do not call handle_images]";

    if (media) {
      const finalImageUrl = media.url || 
                             (media.base64 ? `data:${media.type || 'image/jpeg'};base64,${media.base64}` : null) ||
                             (media.data ? `data:${media.type || 'image/jpeg'};base64,${media.data}` : null);
      if (finalImageUrl) {
          systemMediaFlag = "[SYSTEM FLAG: USER ATTACHED AN IMAGE. YOU MUST CALL handle_images TO ANALYZE IT]";
          messages[messages.length - 1] = {
            role: "user",
            content: [ 
                { type: "text", text: `${systemMediaFlag}\n\nUser Text: ${rawText || "I'm looking for this product."}` }, 
                { type: "image_url", image_url: { url: finalImageUrl } } 
            ]
          };
      } else {
          messages[messages.length - 1].content = `${systemMediaFlag}\n\nUser Text: ${rawText}`;
      }
    } else {
         messages[messages.length - 1].content = `${systemMediaFlag}\n\nUser Text: ${rawText}`;
    }

    const activeTools = toolsReq.data?.map((row: any) => ({
      type: "function",
      function: { 
          name: row.tools_library.name, 
          description: row.tools_library.description, 
          parameters: row.tools_library.parameters 
      }
    })) || [];

    // --- EXECUTE PRIMARY MODEL CALL ---
    console.log(`\n[BRAIN] 🤖 Executing First Pass GPT-4o-mini payload`);
    
    let completion;
    try {
        completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: messages as any,
          tools: activeTools.length ? activeTools : undefined,
          tool_choice: activeTools.length ? "auto" : undefined, 
        });
    } catch (openAiErr: any) {
        console.error(`\n[BRAIN] ❌ First Pass OpenAI Error:`, openAiErr.message);
        throw openAiErr;
    }

    const aiMessage = completion.choices[0].message;
    let rawContent = aiMessage.content ?? "";
    const toolCallsRaw = aiMessage.tool_calls;
    
    const { cleanText, thoughts } = processAiThoughts(rawContent, toolCallsRaw);
    
    if (thoughts && !is_simulation) {
        supabase.from("thinking_logs").insert({
            business_id: businessId, conversation_id: conversationId,
            user_message: rawText, thinking_process: thoughts, ai_response: cleanText
        }).then(({ error }) => {
            if (error) console.error("\n[BRAIN] ❌ Main Thinking Log Error:", error);
            else console.log("\n[BRAIN] ✅ Main Thinking Log Saved Backgrounded");
        });
    }

    const sanitizedAiMessage: any = { role: "assistant", content: cleanText };
    if (aiMessage.tool_calls) sanitizedAiMessage.tool_calls = aiMessage.tool_calls;
    const toolCalls = sanitizedAiMessage.tool_calls;

    if (!toolCalls?.length) {
      if (is_simulation) {
          return new Response(JSON.stringify({ events: [{ type: 'text', text: sanitizedAiMessage.content }] }));
      }

      await Promise.all([
        dispatchOutbound({ type: "text", text: sanitizedAiMessage.content, recipientId: userId, businessId }, platform),
        supabase.from("messages").insert({
            conversation_id: conversationId, business_id: businessId, direction: "out", role: "ai", 
            content: { text: sanitizedAiMessage.content }, status: "sent"
        }).then(({ error }) => {
            if (error) console.error("\n[BRAIN] ❌ Outbound Direct Text Insert Error:", error);
        })
      ]);
      
      if (!is_simulation) {
          // @ts-ignore
          if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(summarizeConversationIfNeeded(conversationId, businessId));
      }
      
      if (platform === "facebook" || platform === "instagram") {
          return new Response(JSON.stringify({ version: "v2", content: { messages: [] } }));
      }
      return new Response(JSON.stringify({ reply: sanitizedAiMessage.content }));
    }

    messages.push(sanitizedAiMessage);
    const statusMsg = TOOL_STATUS_MESSAGES[toolCalls[0].function.name];

    if (is_simulation) {
        const simulationLogs: any[] = [];
        if (statusMsg) simulationLogs.push({ type: 'text', text: statusMsg });
        
        await executeToolsAndDispatch(toolCalls, messages, userId, businessId, platform, conversationId, finalSystemMessage, media, simulationLogs);
        return new Response(JSON.stringify({ events: simulationLogs }));
    }

    const backgroundTask = executeToolsAndDispatch(toolCalls, messages, userId, businessId, platform, conversationId, finalSystemMessage, media);
    
    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(backgroundTask);
    else backgroundTask.catch(console.error);

    if (!is_simulation) {
        // @ts-ignore
        if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(summarizeConversationIfNeeded(conversationId, businessId));
    }

    if (platform === "facebook" || platform === "instagram") {
        return new Response(JSON.stringify({ 
            version: "v2", 
            content: { messages: [{ type: "text", text: statusMsg || "Processing..." }] } 
        }));
    }

    if (statusMsg) {
        await dispatchOutbound({ type: "text", text: statusMsg, recipientId: userId, businessId }, platform).catch(console.error);
    }
    
    return new Response(JSON.stringify({ status: "processing" }));

  } catch (err: any) {
    console.error(`\n[BRAIN] 💀 FATAL HANDLER ERROR:`, err.message);
    
    const fallbackMsg = `AI is currently unavailable. Contact ${fallbackPhone} or visit ${fallbackWebsite}.`;

    try {
      if (fallbackPayload?.conversationId) {
        const { error: fbErr } = await supabase.from("messages").insert({
          conversation_id: fallbackPayload.conversationId,
          business_id: fallbackPayload.businessId,
          direction: "out",
          role: "ai", 
          content: { text: fallbackMsg, error_log: err.message },
          status: "sent"
        });
        if (fbErr) console.error("\n[BRAIN] ❌ Fallback Insert Failed:", fbErr);
      }
    } catch (logErr) {
      console.error("\n[BRAIN] 🚨 Logging failed:", logErr);
    }

    if (fallbackPayload?.platform === "facebook" || fallbackPayload?.platform === "instagram") {
      return new Response(JSON.stringify({ 
        version: "v2", 
        content: { 
          messages: [{ type: "text", text: fallbackMsg }] 
        } 
      }), { status: 200 });
    }

    if (fallbackPayload?.userId && fallbackPayload?.businessId) {
      await dispatchOutbound({ 
        type: "text", 
        text: fallbackMsg, 
        recipientId: fallbackPayload.userId, 
        businessId: fallbackPayload.businessId 
      }, fallbackPayload.platform).catch(() => {});
    }

    return new Response(JSON.stringify({ error: "service_unavailable", fallback_sent: true }), { status: 200 });
  }
});