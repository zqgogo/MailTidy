import { HeuristicEmbeddingProvider } from "./heuristic.js";

const provider = new HeuristicEmbeddingProvider();

// 测试用例
const testCases = [
  {
    name: "完全相同的文本",
    text1: "Archive newsletter emails from sender",
    text2: "Archive newsletter emails from sender",
  },
  {
    name: "语义相似但文本不同",
    text1: "Archive newsletter emails",
    text2: "Archive weekly newsletter",
  },
  {
    name: "完全不同的文本",
    text1: "Archive newsletter emails",
    text2: "Reply to boss about project",
  },
  {
    name: "只有一个字符不同",
    text1: "Archive newsletter emails",
    text2: "Archive newsletter email",
  },
];

async function runTests() {
  console.log("=== HeuristicEmbeddingProvider 测试 ===\n");

  for (const testCase of testCases) {
    const embeddings = await provider.embed([testCase.text1, testCase.text2]);
    const vec1 = embeddings[0];
    const vec2 = embeddings[1];

    if (!vec1 || !vec2) continue;

    const similarity = cosineSimilarity(vec1, vec2);

    console.log(`测试: ${testCase.name}`);
    console.log(`文本1: "${testCase.text1}"`);
    console.log(`文本2: "${testCase.text2}"`);
    console.log(`相似度: ${similarity.toFixed(4)}`);
    console.log(`向量1前5维: [${vec1.slice(0, 5).map(v => v.toFixed(3)).join(", ")}]`);
    console.log(`向量2前5维: [${vec2.slice(0, 5).map(v => v.toFixed(3)).join(", ")}]`);
    console.log("---\n");
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

runTests().catch(console.error);