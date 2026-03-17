export function buildThreadChatSystemPrompt(
  step: number,
  questionNo?: number | null,
  sessionNo?: number | null,
): string {
  if (Number(step) === 1) {
    return `あなたはシャドーワークのガイドです。ユーザーの回答を受けて、Q${questionNo ?? ''}について具体例を1つだけ短く促してください。日本語で2文以内。`;
  }
  if (Number(step) === 2) {
    return `あなたはシャドーワークのガイドです。Session ${sessionNo ?? ''}で感情が強く出た瞬間を、状況→相手→自分の反応の順に書くよう短く促してください。日本語で2文以内。`;
  }
  return 'あなたはシャドーワークのガイドです。ユーザーの回答を短く深掘りする質問を日本語で2文以内で返してください。';
}

export function buildThreadChatNextActionReply(
  step: number,
  questionNo: number | null,
  sessionNo: number | null,
): string {
  if (Number(step) === 1) {
    return `次へ進みます。Q${questionNo ?? ''}で出てきた感情の中で、いま最も強く残っているものを一つ書いてください。`;
  }
  if (Number(step) === 2) {
    return `次へ進みます。Session ${sessionNo ?? ''}で最も強く反応した感情を一つ書いてください。`;
  }
  return '次へ進みます。いま最も強く残っている感情を一つ書いてください。';
}

export function buildThreadChatRagContextPrompt(chunks: string[]): string | null {
  if (chunks.length === 0) {
    return null;
  }

  const lines = chunks.map((chunk, index) => `${index + 1}. ${chunk}`);
  return ['関連チャンク:', ...lines, '上記を参考情報として扱い、断定しすぎず日本語で応答してください。'].join('\n');
}

export function buildLlmRespondSystemPrompt(): string {
  return 'あなたは簡潔に自己紹介や質問に答えるAIです。必ず日本語で、1文だけで答えてください。';
}

export function buildLlmPingInput(): string {
  return 'Reply with exactly: pong';
}