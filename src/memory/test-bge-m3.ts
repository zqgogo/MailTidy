import { BGEM3Embedding } from "./embedding_provider.js";

/**
 * 测试 BGE-M3 嵌入效果
 */
async function testBGEM3() {
  console.log("=== BGE-M3 Embedding 测试 ===\n");

  // 创建嵌入提供者
  const provider = new BGEM3Embedding();

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
      name: "部分重叠的文本",
      text1: "GitHub Actions Update",
      text2: "GitHub Changelog",
    },
    {
      name: "同义词替换",
      text1: "Email from bank is important",
      text2: "Message from financial institution is significant",
    },
  ];

  console.log("正在加载 BGE-M3 模型...（首次运行会下载模型，约 1GB）\n");

  // 生成所有嵌入
  const allTexts = testCases.flatMap((tc) => [tc.text1, tc.text2]);
  const embeddings = await provider.embed(allTexts);

  console.log("模型加载完成！\n");

  // 计算相似度并输出结果
  let textIndex = 0;
  for (const testCase of testCases) {
    const vec1 = embeddings[textIndex++];
    const vec2 = embeddings[textIndex++];

    if (!vec1 || !vec2) {
      console.log(`测试: ${testCase.name} - 跳过（嵌入为空）`);
      console.log(`---\n`);
      continue;
    }

    const similarity = cosineSimilarity(vec1, vec2);

    console.log(`测试: ${testCase.name}`);
    console.log(`文本1: "${testCase.text1}"`);
    console.log(`文本2: "${testCase.text2}"`);
    console.log(`相似度: ${similarity.toFixed(4)}`);
    console.log(`向量维度: ${vec1.length}`);
    console.log(`---\n`);
  }

  // 测试批量嵌入
  console.log("批量嵌入测试:");
  const batchTexts = [
    "GitHub notification",
    "AWS billing alert",
    "Bank statement",
    "Job offer",
  ];
  const batchEmbeddings = await provider.embed(batchTexts);
  console.log(`输入: ${batchTexts.length} 条文本`);
  console.log(`输出: ${batchEmbeddings.length} 个向量`);
  console.log(`每个向量维度: ${batchEmbeddings[0]?.length ?? 0}`);
}

/**
 * 余弦相似度计算
 */
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

// 运行测试
testBGEM3().catch((error) => {
  console.error("测试失败:", error);
  process.exit(1);
});