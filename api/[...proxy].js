/**
 * Vercel Edge Function for OpenAI API Proxy (Clean URL Version)
 *
 * Routing is now handled by vercel.json.
 * This function handles authentication and forwards requests to upstream APIs.
 */

export const config = {
  runtime: 'edge',
};

// -------------------- 1. 自定义配置 (与之前相同) --------------------
const upstreamBaseURLs = [
  "https://kokoai.de/v1",
  "https://text.pollinations.ai/openai",
  "https://api.nyxar.org/v1",
  "https://ai.huan666.de/v1",
  "https://api.damoxing.site/v1",
  "https://api.voct.dev/v1",
  "https://apix.778801.xyz/v1",
];
const redirectUrl = "https://www.fimall.lol/"; // Fallback redirect
const fallbackModelsList = [
  {
    id: "openai",
    sourceKey: "https://text.pollinations.ai/openai",
  },
];

// -------------------- 2. 全局状态和辅助函数 (与之前相同, 无需修改) --------------------
const apiSources = new Map();
let preloadedModelsMap = new Map();
let preloadedModelsListForResponse = [];
let initializePromise = null;

function generateApiKeyEnvName(baseURL) {
  try {
    const hostname = new URL(baseURL).hostname;
    const parts = hostname.split('.');
    const secondLevelDomain = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    return secondLevelDomain.toUpperCase();
  } catch (error) {
    console.error(`无法从 '${baseURL}' 解析主机名: ${error.message}`);
    return baseURL.replace(/^https?:\/\//, "").toUpperCase().replace(/[./-]/g, "_");
  }
}

function setupApiSources() {
  console.log("正在根据 baseURL 列表自动配置 API 源...");
  upstreamBaseURLs.forEach(baseURL => {
    const apiKeyEnvName = generateApiKeyEnvName(baseURL);
    const apiKey = process.env[apiKeyEnvName];
    if (!apiKey) {
      console.warn(`警告: 未找到环境变量 '${apiKeyEnvName}' 用于 '${baseURL}'。`);
    }
    apiSources.set(baseURL, { baseURL, apiKey });
    console.log(`已配置源: ${baseURL} (使用环境变量: ${apiKeyEnvName})`);
  });
  console.log("API 源自动配置完成。");
}

async function preloadModels() {
    // ... 此函数内容与上一版完全相同，为简洁此处省略 ...
    // ... The content of this function is identical to the previous version ...
    console.log("开始预加载模型列表...");
    preloadedModelsMap.clear();
    preloadedModelsListForResponse = [];
    const MAX_RETRIES = 5;
    for (const [sourceKey, source] of apiSources.entries()) {
        const modelsUrl = `${source.baseURL}/models`;
        let sourceModelsLoaded = false;
        let retries = 0;
        while (!sourceModelsLoaded && retries < MAX_RETRIES) {
            if (retries > 0) {
                await new Promise(resolve => setTimeout(resolve, 1000 * retries));
            }
            try {
                const response = await fetch(modelsUrl, { headers: { "Authorization": `Bearer ${source.apiKey}`, "Content-Type": "application/json" } });
                if (!response.ok) {
                    retries++; continue;
                }
                const data = await response.json();
                if (data && Array.isArray(data.data) && data.data.length > 0) {
                    data.data.forEach((model) => {
                        const userFacingModelId = model.id;
                        if (!preloadedModelsMap.has(userFacingModelId)) {
                            preloadedModelsMap.set(userFacingModelId, { sourceKey: sourceKey, upstreamModelId: model.id });
                            preloadedModelsListForResponse.push({ id: userFacingModelId, object: model.object || "model", owned_by: model.owned_by || new URL(sourceKey).hostname });
                        }
                    });
                    sourceModelsLoaded = true;
                } else {
                    retries++;
                }
            } catch (error) {
                retries++;
            }
        }
        if (!sourceModelsLoaded) {
            fallbackModelsList.forEach(model => {
                if (model.sourceKey === sourceKey) {
                    const userFacingModelId = model.id;
                    if (!preloadedModelsMap.has(userFacingModelId)) {
                        preloadedModelsMap.set(userFacingModelId, { sourceKey: sourceKey, upstreamModelId: userFacingModelId });
                        preloadedModelsListForResponse.push({ id: userFacingModelId, object: "model", owned_by: new URL(sourceKey).hostname });
                    }
                }
            });
        }
    }
    preloadedModelsListForResponse.sort((a, b) => a.id.localeCompare(b.id));
}

async function initialize() {
  if (!initializePromise) {
    initializePromise = (async () => {
      console.log("Edge Function 实例正在初始化...");
      setupApiSources();
      await preloadModels();
      console.log("Edge Function 初始化完成。");
    })();
  }
  return initializePromise;
}

// -------------------- 4. 请求处理器 (与之前相同) --------------------
async function handleModelsRequest() {
  const responseBody = { object: "list", data: preloadedModelsListForResponse };
  return new Response(JSON.stringify(responseBody), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function handleModelRequest(request, pathname) {
  let requestBody;
  try {
    requestBody = await request.clone().json();
  } catch (error) {
    return new Response("无效的请求体，无法解析 JSON", { status: 400 });
  }
  const requestedModel = requestBody?.model;
  if (!requestedModel) {
    return new Response("请求体中缺少 'model'字段", { status: 400 });
  }
  const modelInfo = preloadedModelsMap.get(requestedModel);
  if (!modelInfo) {
    return new Response(`找不到模型 '${requestedModel}'`, { status: 404 });
  }
  const source = apiSources.get(modelInfo.sourceKey);
  if (!source) {
    return new Response(`内部错误: 找不到模型 '${requestedModel}' 对应的源配置`, { status: 500 });
  }
  // 由于 vercel.json 的重写，pathname 是 /api/v1/...，我们需要去掉 /api 前缀
  const upstreamPath = pathname.replace(/^\/api/, '');
  const upstreamUrl = `${source.baseURL}${upstreamPath}`;
  
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${source.apiKey}`);
  headers.set("Content-Type", "application/json");
  requestBody.model = modelInfo.upstreamModelId;

  try {
    return await fetch(upstreamUrl, { method: request.method, headers, body: JSON.stringify(requestBody) });
  } catch (error) {
    return new Response(`转发请求失败: ${error.message}`, { status: 500 });
  }
}

// -------------------- 5. CORS 和服务主逻辑 (已简化) --------------------
function addCorsHeaders(response) {
  const newHeaders = new Headers(response.headers);
  newHeaders.set("Access-Control-Allow-Origin", "*");
  newHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  newHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  newHeaders.set("Access-Control-Max-Age", "86400");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: newHeaders });
}

// Vercel Edge Function 入口点 (已更新)
export default async function handler(request) {
  await initialize();

  if (request.method === "OPTIONS") {
    return addCorsHeaders(new Response(null, { status: 204 }));
  }

  // --- 鉴权 ---
  const proxyAuthKey = process.env.PROXY_AUTH_KEY;
  const authHeader = request.headers.get("Authorization");

  if (!proxyAuthKey) {
    console.error("错误: 环境变量 PROXY_AUTH_KEY 未设置。");
    return addCorsHeaders(new Response("代理服务配置错误", { status: 500 }));
  }
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return addCorsHeaders(new Response("缺少 Authorization: Bearer <proxy_key> 请求头", { status: 401 }));
  }
  const inboundKey = authHeader.substring("Bearer ".length).trim();
  if (inboundKey !== proxyAuthKey) {
    return addCorsHeaders(new Response("代理鉴权失败", { status: 401 }));
  }

  // --- 路由处理 ---
  const url = new URL(request.url);
  // pathname 会是 /api/v1/... 的形式，因为 vercel.json 已经将 /v1/... 重写到 /api/v1/...
  const pathname = url.pathname;
  let response;

  if (pathname === "/api/v1/models") {
    response = await handleModelsRequest();
  } else if (pathname.startsWith("/api/v1/")) {
    response = await handleModelRequest(request, pathname);
  } else {
    // 这个情况理论上不会发生，因为 vercel.json 会处理根路径重定向
    // 但作为备用方案，我们仍然可以设置重定向
    response = new Response(null, {
      status: 302,
      headers: { "Location": redirectUrl },
    });
  }

  return addCorsHeaders(response);
}
