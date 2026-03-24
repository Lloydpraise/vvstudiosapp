import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

serve(async (req) => {
  // 1. Handle CORS Preflight for the browser
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const action = payload.action;

    console.log(`[TESTER] Received action: ${action}`);

    // ===== DATABASE ACTIONS (Direct Supabase Queries) =====

    // 1️⃣ FETCH INITIAL DATA: Master Prompt + Business Prompt + Tools
    if (action === "fetch_init_data") {
      const businessId = payload.businessId;
      
      if (!businessId) {
        throw new Error("businessId is required for fetch_init_data");
      }

      console.log(`[TESTER] Fetching init data for business: ${businessId}`);

      // Query 1: Global Config (Master Prompt)
      const { data: globalConfig, error: globalError } = await supabase
        .from("global_config")
        .select("master_system_prompt")
        .eq("id", 1)
        .single();

      if (globalError) {
        console.error("[TESTER] Error fetching global_config:", globalError);
      }

      // Query 2: Business Config (Business Prompt)
      const { data: business, error: businessError } = await supabase
        .from("businesses")
        .select("system_prompt")
        .eq("business_id", businessId)
        .single();

      if (businessError) {
        console.error(`[TESTER] Error fetching business prompt for ${businessId}:`, businessError);
      }

      // Query 3: Tools Library
      const { data: tools, error: toolsError } = await supabase
        .from("tools_library")
        .select("id, name, description, parameters")
        .order("name", { ascending: true });

      if (toolsError) {
        console.error("[TESTER] Error fetching tools_library:", toolsError);
      }

      console.log(`[TESTER] Global Config:`, globalConfig);
      console.log(`[TESTER] Business Config:`, business);
      console.log(`[TESTER] Tools Count:`, tools?.length || 0);

      return new Response(JSON.stringify({
        master_system_prompt: globalConfig?.master_system_prompt || "",
        system_prompt: business?.system_prompt || "",
        tools: tools || [],
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // 2️⃣ FETCH ALL BUSINESSES
    if (action === "fetch_businesses") {
      console.log("[TESTER] Fetching all businesses from businesses table");

      const { data: businesses, error: businessesError } = await supabase
        .from("businesses")
        .select("business_id, name, industry, business_type, subscription_active")
        .order("name", { ascending: true });

      if (businessesError) {
        console.error("[TESTER] Error fetching businesses:", businessesError);
        throw businessesError;
      }

      console.log(`[TESTER] Retrieved ${businesses?.length || 0} businesses`);

      return new Response(JSON.stringify({
        businesses: businesses || [],
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // 3️⃣ UPDATE PROMPTS (Master + Business)
    if (action === "update_prompts") {
      const businessId = payload.businessId;
      const masterPrompt = payload.master_system_prompt;
      const businessPrompt = payload.system_prompt;

      if (!businessId) {
        throw new Error("businessId is required for update_prompts");
      }

      console.log(`[TESTER] Updating prompts for business: ${businessId}`);

      // Update global_config (Master Prompt)
      if (masterPrompt) {
        const { error: updateError } = await supabase
          .from("global_config")
          .update({ master_system_prompt: masterPrompt })
          .eq("id", 1);

        if (updateError) {
          console.error("[TESTER] Error updating global_config:", updateError);
          throw updateError;
        }
        console.log("[TESTER] ✅ global_config.master_system_prompt updated");
      }

      // Update businesses (Business Prompt)
      if (businessPrompt) {
        const { error: updateError } = await supabase
          .from("businesses")
          .update({ system_prompt: businessPrompt })
          .eq("business_id", businessId);

        if (updateError) {
          console.error("[TESTER] Error updating businesses:", updateError);
          throw updateError;
        }
        console.log(`[TESTER] ✅ businesses.system_prompt updated for ${businessId}`);
      }

      return new Response(JSON.stringify({
        success: true,
        message: "Prompts updated successfully",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // 4️⃣ UPDATE TOOL
    if (action === "update_tool") {
      const toolId = payload.toolId;
      const name = payload.name;
      const description = payload.description;
      const parameters = payload.parameters;

      if (!toolId) {
        throw new Error("toolId is required for update_tool");
      }

      console.log(`[TESTER] Updating tool: ${toolId}`);

      const updateData: any = {};
      if (name) updateData.name = name;
      if (description) updateData.description = description;
      if (parameters) updateData.parameters = parameters;

      const { error: updateError } = await supabase
        .from("tools_library")
        .update(updateData)
        .eq("id", toolId);

      if (updateError) {
        console.error("[TESTER] Error updating tools_library:", updateError);
        throw updateError;
      }

      console.log(`[TESTER] ✅ tools_library row ${toolId} updated`);

      return new Response(JSON.stringify({
        success: true,
        message: "Tool updated successfully",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ===== SIMULATION ACTION (Forward to Brain Function) =====
    if (action === "simulate") {
      console.log(`[TESTER] 🛠️ Processing simulation payload...`);

      // 1. STANDARDIZE MEDIA (Base64 from Simulator or URL)
      // This ensures the Brain's 'briefcase.media' is never empty
      let standardizedMedia = null;
      if (payload.media) {
        const { url, base64, mime_type } = payload.media;
        if (base64) {
          const mime = mime_type || "image/jpeg";
          standardizedMedia = { url: `data:${mime};base64,${base64}`, type: "image" };
          console.log(`[TESTER] 📸 Detected Base64 image. Standardizing...`);
        } else if (url) {
          standardizedMedia = { url: url, type: "image" };
          console.log(`[TESTER] 🔗 Detected image URL. Standardizing...`);
        }
      }

      // 2. APPLY OVERRIDES & ATTACH MEDIA
      const forwardPayload = {
        ...payload,
        media: standardizedMedia, // 🚨 Injection: This is what the Brain was missing!
        is_simulation: true,
        businessId: payload.businessId || "kisasacraft66",
        userId: payload.userId || "test_user_999",
        conversationId: payload.conversationId || "test_conv_999",
        platform: payload.platform || "simulator"
      };

      const MAIN_BRAIN_FUNCTION_NAME = "model-tester"; 
      const brainUrl = `${supabaseUrl}/functions/v1/${MAIN_BRAIN_FUNCTION_NAME}`;

      console.log(`[TESTER] 📡 Forwarding to Brain: ${brainUrl}`);

      const brainResponse = await fetch(brainUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(forwardPayload)
      });

      if (!brainResponse.ok) {
        const errorText = await brainResponse.text();
        throw new Error(`Brain Function Error: ${errorText}`);
      }

      const brainData = await brainResponse.json();

      return new Response(JSON.stringify(brainData), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ===== UNKNOWN ACTION =====
    throw new Error(`Unknown action: ${action}`);

  } catch (error: any) {
    console.error("[TESTER] Webhook Error:", error.message);
    return new Response(JSON.stringify({ 
      error: error.message,
      details: error.details || null
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
