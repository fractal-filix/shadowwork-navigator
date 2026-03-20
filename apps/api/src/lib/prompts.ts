export const SHADOWWORK_STEP1_QUESTIONS = [
  '他人のどんなとこが嫌いか',
  '他人のどんなところに嫉妬しているか',
  '絶対に他人に知られたくない自分の一部は何か？そして、なぜそれを隠そうとしているのか？',
  '自分が無意識に避けている記憶は何だろうか？',
  'あなたが恥ずかしいと感じる行動や癖は何か？',
] as const;

export const SHADOWWORK_STEP2_JOURNAL_FLOW = [
  '①その日、最も強く反応した感情を書く',
  '②なぜそう感じたのか、自己対話する。根本信念に到達するまでwhyを繰り返す。whyに答えるときは感情の下層にどんな信念があるかを意識する。',
  '③信念を受容する',
  '④信念を統合（アウフヘーベン）する',
  '⑤まとめ（何がシャドウで、どう統合されたか等）',
] as const;

export const SHADOWWORK_PROGRESS_RULES = [
  '①〜④を一発で出力せず、ユーザーがついていけるように、ユーザーに質問して回答を引き出しながら、一歩ずつ進めること。',
  'ユーザーが②の理由を一つ書いたら、一つ下の下層にどんな信念があるか深掘りするための質問やヒントをユーザーに投げかけること。',
  '十分に深掘りできてから③へ進み、③が十分に進んでから④へ進むこと。',
  'ユーザー自身が一歩一歩内省を深めていけるようにサポートすること。',
  'ユーザーの回答を踏まえ、同じ論点を繰り返しすぎないこと。',
] as const;

export const SHADOWWORK_STEP2_SESSION_OPENER = '今日一番強く反応した感情はなんですか？';

function getStep1Question(questionNo: number | null | undefined): string {
  if (!Number.isInteger(questionNo)) {
    throw new Error('invalid thread prompt state: question_no is required for step 1');
  }

  const question = SHADOWWORK_STEP1_QUESTIONS[Number(questionNo) - 1];
  if (!question) {
    throw new Error(`invalid thread prompt state: unsupported step1 question_no ${questionNo}`);
  }

  return question;
}

function getStep2Session(sessionNo: number | null | undefined): number {
  if (!Number.isInteger(sessionNo) || Number(sessionNo) <= 0) {
    throw new Error('invalid thread prompt state: session_no is required for step 2');
  }

  return Number(sessionNo);
}

export function buildThreadStartOpener(
  step: number,
  questionNo?: number | null,
  sessionNo?: number | null,
): string {
  if (Number(step) === 1) {
    const currentQuestion = getStep1Question(questionNo);
    return `Q${questionNo}: ${currentQuestion}`;
  }
  if (Number(step) === 2) {
    getStep2Session(sessionNo);
    return SHADOWWORK_STEP2_SESSION_OPENER;
  }
  throw new Error(`invalid thread prompt state: unsupported step ${step}`);
}

export function buildThreadChatSystemPrompt(
  step: number,
  questionNo?: number | null,
  sessionNo?: number | null,
): string {
  if (Number(step) === 1) {
    const currentQuestion = getStep1Question(questionNo);
    return `あなたはシャドーワークのガイドです。shadowwork-navigator の step1 は、初日の5つの質問を一歩ずつ深める段階です。現在の設問は Q${questionNo}:「${currentQuestion}」です。初日の5つの質問は次の通りです: ${SHADOWWORK_STEP1_QUESTIONS.map((question, index) => `Q${index + 1}. ${question}`).join(' / ')}。ユーザーの直前の回答を受けて、感情、本音、恐れ、隠したい部分を少しだけ深掘りするための質問か短いヒントを1つだけ返してください。複数の論点を一度に進めず、答えを代わりに書かず、ユーザー自身の気づきを引き出すことを優先してください。`;
  }
  if (Number(step) === 2) {
    const currentSession = getStep2Session(sessionNo);
    return `あなたはシャドーワークのガイドです。shadowwork-navigator の step2 は、二日目以降の日々のジャーナルです。現在は Session ${currentSession} を扱っています。進行は ${SHADOWWORK_STEP2_JOURNAL_FLOW.join(' / ')} です。必ず ${SHADOWWORK_PROGRESS_RULES.join(' / ')}。`;
  }
  throw new Error(`invalid thread prompt state: unsupported step ${step}`);
}

export function buildThreadChatNextActionReply(
  step: number,
  questionNo: number | null,
  sessionNo: number | null,
): string {
  if (Number(step) === 1) {
    const currentQuestion = getStep1Question(questionNo);
    return `次へ進みます。初日の質問 Q${questionNo}:「${currentQuestion}」を踏まえて、いま最も強く残っている感情や本音を一つ書いてください。そこから一歩ずつ深掘りします。`;
  }
  if (Number(step) === 2) {
    const currentSession = getStep2Session(sessionNo);
    return `次へ進みます。Session ${currentSession}で最も強く反応した感情を一つ書いてください。why を重ねながら、下層の信念を一段ずつ深掘りしていきます。`;
  }
  throw new Error(`invalid thread prompt state: unsupported step ${step}`);
}

export function buildThreadChatRagContextPrompt(chunks: string[]): string | null {
  if (chunks.length === 0) {
    return null;
  }

  const lines = chunks.map((chunk, index) => `${index + 1}. ${chunk}`);
  return ['関連チャンク:', ...lines, '上記は過去のユーザー文脈として参考にしてください。現在のユーザー入力を優先し、断定しすぎず、一度に一歩だけ深掘りする日本語の応答を返してください。'].join('\n');
}

export function buildLlmRespondSystemPrompt(): string {
  return 'あなたは簡潔に自己紹介や質問に答えるAIです。必ず日本語で、1文だけで答えてください。';
}

export function buildLlmPingInput(): string {
  return 'Reply with exactly: pong';
}