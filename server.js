const express = require("express");
const path = require("path");

// Node 18+는 fetch 내장
const fetchFn = global.fetch;

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VECTOR_STORE_ID = "vs_6a1ee15dd3e88191a902e2dd2aa8c637";
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1";

if (!OPENAI_API_KEY) {
  console.warn("⚠️ OPENAI_API_KEY 환경변수가 비어있어요. Render 환경변수 설정을 확인하세요.");
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && typeof m === "object")
    .map((m) => {
      const role = m.role === "assistant" ? "assistant" : "user";
      const content = (
        typeof m.content === "string"
          ? m.content
          : typeof m.text === "string"
            ? m.text
            : ""
      ).trim();
      return { role, content };
    })
    .filter((m) => m.content.length > 0);
}

function cleanAnswerText(text) {
  return String(text || "")
    .replace(/~~/g, "")
    .replace(/<s>|<\/s>|<del>|<\/del>/gi, "")
    .trim();
}

async function callOpenAI(messages) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 비어있습니다.");
  if (!fetchFn) throw new Error("현재 Node에 fetch가 없습니다. Node 18 이상이 필요합니다.");

  const normalized = normalizeMessages(messages);
  const input = normalized.map((m) => {
    if (m.role === "assistant") {
      return { role: "assistant", content: [{ type: "output_text", text: m.content }] };
    }
    return { role: "user", content: [{ type: "input_text", text: m.content }] };
  });

  const instructions = `
당신은 "청렴톡톡"입니다. 공직자 청렴 관련 법령과 사례를 쉽게 설명하는 한국어 챗봇입니다.

[답변 원칙]
- 반드시 file_search로 검색된 벡터스토어 자료에 근거해서만 답변하세요.
- 등록된 자료에서 근거를 찾지 못하면 "등록된 자료에서 확인되지 않습니다."라고 답하고 추측하지 마세요.
- 중학생도 이해할 수 있게 쉬운 말로 설명하세요.
- 가능한 경우 "핵심 결론 → 쉬운 설명 → 예시 → 확인할 근거" 순서로 답변하세요.
- 법령명, 조항, 금액 기준, 예외 사항은 자료에 있는 경우에만 단정적으로 말하세요.
- 실제 위반 여부는 구체적 사실관계에 따라 달라질 수 있으므로, 필요한 경우 소속 기관 감사부서 또는 담당 부서 확인이 필요하다고 안내하세요.
- 사용자가 뉴스레터, 교육자료, 퀴즈, 사례문을 요청하면 자료 근거 범위 안에서 실무적으로 바로 쓸 수 있게 작성하세요.
`.trim();

  const body = {
    model: MODEL,
    instructions,
    input,
    tools: [
      {
        type: "file_search",
        vector_store_ids: [VECTOR_STORE_ID],
        max_num_results: 10,
      },
    ],
    include: ["file_search_call.results"],
  };

  const response = await fetchFn("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`OpenAI API 오류 (${response.status}): ${errText}`);
  }

  const data = await response.json();

  if (data.usage) {
    const inputTokens = data.usage.input_tokens || 0;
    const outputTokens = data.usage.output_tokens || 0;
    console.log(`📊 [청렴톡톡] input=${inputTokens} output=${outputTokens} total=${inputTokens + outputTokens}`);
  }

  const searchResults = (data.output || [])
    .filter((o) => o.type === "file_search_call")
    .flatMap((o) => o.results || []);

  if (!searchResults || searchResults.length === 0) {
    return "등록된 자료에서 확인되지 않습니다.";
  }

  const text = (data.output || [])
    .flatMap((o) => o.content || [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text)
    .join("\n")
    .trim();

  return text || "등록된 자료에서 확인되지 않습니다.";
}

app.post("/api/cheongnyeomtoktok", async (req, res) => {
  try {
    const answer = await callOpenAI(req.body.messages);
    res.json({ text: cleanAnswerText(answer) });
  } catch (e) {
    console.error("❌ /api/cheongnyeomtoktok 오류:", e.message);
    res.status(500).json({
      text: "청렴톡톡 서버 오류가 발생했습니다.",
      detail: e.message,
    });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ http://localhost:${PORT} 실행 중`);
  console.log("✅ API: POST /api/cheongnyeomtoktok");
  console.log(`✅ Vector Store: ${VECTOR_STORE_ID}`);
});
