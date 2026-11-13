// textProcessor.ts

export type Topic = "科技" | "财经" | "教育" | "娱乐" | "体育" | "其他"

export type LanguageCode =
  | "zh" | "en" | "ja" | "ko" | "fr" | "es" | "de" | "ru" | "ar" | "pt"
  | "mixed" | "unknown"

export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  zh: '中文', en: '英语', ja: '日语', ko: '韩语', fr: '法语', es: '西班牙语',
  de: '德语', ru: '俄语', ar: '阿拉伯语', pt: '葡萄牙语', mixed: '混合语言', unknown: '未知',
}

/** Heuristic conversational rates, including ordinary pauses.
 * zh/ja/ko use spoken characters; other languages use words.
 * mixed/unknown use a fallback rate. These are estimates, not TTS guarantees.
 */
const SPEECH_UNITS_PER_MINUTE: Record<LanguageCode, number> = {
  zh: 240, ja: 300, ko: 250, en: 150, fr: 160, es: 170,
  de: 140, ru: 140, ar: 130, pt: 160, mixed: 200, unknown: 180,
}

/** Return estimated seconds from a known count, language and playback rate. */
export function estimateSpeechDuration(wordCount: number, language: LanguageCode, speed = 1): number {
  if (!Number.isFinite(wordCount) || wordCount <= 0) return 0
  const effectiveSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1
  return wordCount * 60 / SPEECH_UNITS_PER_MINUTE[language] / effectiveSpeed
}

export interface SpeechSegment {
  text: string
  role_id: string
  speed?: number | null
}

/** A sentence speed overrides its role default; sum unrounded segment durations. */
export function estimateScriptDuration(
  sentences: SpeechSegment[],
  roles: { role_id: string; voice_config: { speed: number } }[],
): number {
  const processor = new TextProcessor()
  return sentences.reduce((seconds, sentence) => {
    const speed = sentence.speed ?? roles.find(role => role.role_id === sentence.role_id)?.voice_config.speed ?? 1
    const text = sentence.text
    const language = processor.detectLanguage(text).language
    if (language === 'ja' || language === 'ko') {
      return seconds + estimateSpeechDuration(processor.getStats(text).wordCount, language, speed)
    }
    // Handle embedded English terms in Chinese without treating words as characters.
    const han = (text.match(HAN_RE) ?? []).length
    const remaining = text.replace(HAN_RE, '')
    return seconds + estimateSpeechDuration(han, 'zh', speed)
      + estimateSpeechDuration(processor.getStats(remaining).wordCount, processor.detectLanguage(remaining).language, speed)
  }, 0)
}

export interface WordFrequency {
  word: string
  count: number
}

export interface TextStats {
  charCount: number
  charCountNoSpaces: number
  wordCount: number
  chineseCharCount: number
  englishWordCount: number
  sentenceCount: number
  paragraphCount: number
}

export interface LanguageDetection {
  language: LanguageCode
  /** 主导语言的置信度 0–1 */
  confidence: number
  /** 各语言得分（便于调试/展示） */
  scores: Partial<Record<LanguageCode, number>>
}

export interface TextAnalysis {
  stats: TextStats
  language: LanguageDetection
  topic: Topic
  keywords: WordFrequency[]
}

export interface AnalyzeOptions {
  topN?: number
  extraStopwords?: string[]
}

// ===========================================================================
// 停用词与特征词
// ===========================================================================

const EN_STOPWORDS = new Set([
  "a","an","the","and","or","but","if","then","else","of","to","in","on",
  "at","by","for","with","about","as","is","are","was","were","be","been",
  "being","it","its","this","that","these","those","i","you","he","she",
  "we","they","them","his","her","their","our","your","my","me","us",
  "from","not","no","do","does","did","have","has","had","will","would",
  "can","could","should","may","might","so","than","too","very","just","also",
])

const ZH_STOPWORDS = new Set([
  "的","了","和","是","在","我","有","你","他","她","它","们","这","那",
  "就","不","也","都","而","与","及","或","对","为","以","于","从","到",
  "被","把","让","给","向","并","但","又","还","很","更","最","会","能",
  "可以","一个","一些","没有","我们","你们","他们","这个","那个","因为",
  "所以","如果","虽然","但是","然后","已经","正在","将","着","过","吗",
  "呢","吧","啊",
])

// 拉丁语系语言的“高频功能词”特征表（区分度核心）
const LATIN_LANG_FEATURES: Record<
  "en" | "fr" | "es" | "de" | "pt",
  { stopwords: string[]; diacritics: RegExp; specialChars: RegExp }
> = {
  en: {
    stopwords: ["the","and","is","are","of","to","in","that","it","for","with","as","on","this","you","be"],
    diacritics: /[^\p{ASCII}]/gu, // 英文几乎无变音
    specialChars: /[^a-zA-Z\s]/g,
  },
  fr: {
    stopwords: ["le","la","les","de","des","du","et","est","un","une","que","qui","dans","pour","avec","sur","pas","au","aux","ce","cette","il","elle","nous","vous","ils","elles","être","avoir"],
    diacritics: /[àâäéèêëîïôöùûüÿçœæ]/gi,
    specialChars: /[àâäéèêëîïôöùûüÿçœæ]/gi,
  },
  es: {
    stopwords: ["el","la","los","las","de","del","y","es","un","una","que","en","por","con","para","no","se","su","al","como","más","pero","este","esta","son","fue"],
    diacritics: /[áéíóúüñ¿¡]/gi,
    specialChars: /[áéíóúüñ¿¡]/gi,
  },
  de: {
    stopwords: ["der","die","das","und","ist","ein","eine","zu","von","mit","sich","auf","für","nicht","den","dem","des","im","in","als","auch","es","werden","wird","hat","haben"],
    diacritics: /[äöüß]/gi,
    specialChars: /[äöüß]/gi,
  },
  pt: {
    stopwords: ["o","a","os","as","de","do","da","e","é","um","uma","que","em","por","com","para","não","se","seu","sua","ao","como","mais","mas","este","esta","são","foi"],
    diacritics: /[áâãàéêíóôõúüç]/gi,
    specialChars: /[áâãàéêíóôõúüç]/gi,
  },
}

// 西里尔字母（俄语）
const CYRILLIC_RE = /[\u0400-\u04ff]/g
// 阿拉伯字母
const ARABIC_RE = /[\u0600-\u06ff\u0750-\u077f]/g
// 汉字
const HAN_RE = /[\u4e00-\u9fff]/g
// 日文假名
const KANA_RE = /[\u3040-\u30ff]/g
// 韩文谚文
const HANGUL_RE = /[\uac00-\ud7af\u1100-\u11ff]/g
// 拉丁字母
const LATIN_RE = /[a-zA-Z\u00c0-\u024f]/g

// ===========================================================================
// 主题关键词（外置，便于扩充）
// ===========================================================================

const TOPIC_KEYWORDS: Record<Exclude<Topic, "其他">, string[]> = {
  科技: ["科技","技术","人工智能","ai","算法","芯片","互联网","软件","硬件","编程","代码","数据","云计算","手机","电脑","机器人","大模型","机器学习","深度学习","5g","区块链","半导体","开源"],
  财经: ["财经","经济","股票","股市","基金","投资","理财","银行","金融","利率","汇率","通胀","gdp","市场","企业","公司","营收","利润","财报","上市","融资","房价","消费","贸易","关税","美元"],
  教育: ["教育","学校","学生","老师","教师","课程","考试","高考","中考","大学","学习","教学","教材","作业","培训","留学","考研","知识","课堂","校园","招生","录取","专业","毕业"],
  娱乐: ["娱乐","电影","电视剧","综艺","明星","演员","歌手","音乐","演唱会","票房","游戏","动漫","小说","导演","剧集","粉丝","偶像","颁奖","红毯","直播","短视频"],
  体育: ["体育","比赛","球队","球员","足球","篮球","网球","乒乓球","奥运","世界杯","冠军","联赛","教练","进球","得分","赛季","运动员","田径","游泳","马拉松","运动"],
}

// ===========================================================================
// 正则
// ===========================================================================

const SENTENCE_DELIMITERS = /[。！？!?….]+/g
const EN_WORD_RE = /[a-zA-Z]+(?:['-][a-zA-Z]+)*/g
const ZH_SEGMENT_RE = /[\u4e00-\u9fff]+/g
const WORD_RE_LATIN = /[a-zA-Z\u00c0-\u024f]+(?:['-][a-zA-Z\u00c0-\u024f]+)*/g

// ===========================================================================
// 主类
// ===========================================================================

export class TextProcessor {
  private readonly extraStopwords: Set<string>

  constructor(options: { extraStopwords?: string[] } = {}) {
    this.extraStopwords = new Set(
      (options.extraStopwords ?? []).map((w) => w.toLowerCase()),
    )
  }

  analyze(text: string, options: AnalyzeOptions = {}): TextAnalysis {
    return {
      stats: this.getStats(text),
      language: this.detectLanguage(text),
      topic: this.detectTopic(text),
      keywords: this.getKeywords(text, options),
    }
  }

  // -------------------------------------------------------------------------
  // 字数统计
  // -------------------------------------------------------------------------

  getStats(text: string): TextStats {
    const charCount = text.length
    const charCountNoSpaces = text.replace(/\s/g, "").length
    const chineseCharCount = (text.match(HAN_RE) ?? []).length
    const englishWordCount = (text.match(EN_WORD_RE) ?? []).length
    // Count CJK characters individually; whitespace-based languages use words.
    const cjk = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []).length
    const otherWords = (text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ').match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’-][\p{L}\p{M}\p{N}]+)*/gu) ?? []).length
    const wordCount = cjk + otherWords

    return {
      charCount,
      charCountNoSpaces,
      wordCount,
      chineseCharCount,
      englishWordCount,
      sentenceCount: this.countSentences(text),
      paragraphCount: text.split(/\n+/).map((p) => p.trim()).filter(Boolean).length,
    }
  }

  private countSentences(text: string): number {
    const trimmed = text.trim()
    if (!trimmed) return 0
    return trimmed.split(SENTENCE_DELIMITERS).map((s) => s.trim()).filter(Boolean).length
  }

  // -------------------------------------------------------------------------
  // 语言检测（10 种 + mixed/unknown）
  // -------------------------------------------------------------------------

  detectLanguage(text: string): LanguageDetection {
    const stripped = text.replace(/\s/g, "")
    const total = stripped.length
    if (total === 0) {
      return { language: "unknown", confidence: 0, scores: {} }
    }

    const han = (text.match(HAN_RE) ?? []).length
    const kana = (text.match(KANA_RE) ?? []).length
    const hangul = (text.match(HANGUL_RE) ?? []).length
    const cyrillic = (text.match(CYRILLIC_RE) ?? []).length
    const arabic = (text.match(ARABIC_RE) ?? []).length
    const latin = (text.match(LATIN_RE) ?? []).length

    // ---- 第一层：按文字系统判定非拉丁语言 ----
    // 日文：假名占非空白字符一定比例（日文必含假名，汉字单独出现则归中文）
    if (kana > 0 && kana / total >= 0.05) {
      return {
        language: "ja",
        confidence: clamp01(kana / total + 0.3),
        scores: { ja: kana / total },
      }
    }
    if (hangul > 0 && hangul / total >= 0.3) {
      return { language: "ko", confidence: clamp01(hangul / total + 0.2), scores: { ko: hangul / total } }
    }
    if (cyrillic > 0 && cyrillic / total >= 0.3) {
      return { language: "ru", confidence: clamp01(cyrillic / total + 0.2), scores: { ru: cyrillic / total } }
    }
    if (arabic > 0 && arabic / total >= 0.3) {
      return { language: "ar", confidence: clamp01(arabic / total + 0.2), scores: { ar: arabic / total } }
    }
    if (han > 0 && han / total >= 0.3) {
      return { language: "zh", confidence: clamp01(han / total + 0.2), scores: { zh: han / total } }
    }

    // ---- 第二层：拉丁字母系语言用特征词 + 变音符号打分 ----
    if (latin / total >= 0.3) {
      return this.detectLatinLanguage(text)
    }

    // 拉丁与其他文字都不占主导 → 混合或未知
    const dominant = Math.max(han, kana, hangul, cyrillic, arabic, latin) / total
    return {
      language: dominant >= 0.3 ? "mixed" : "unknown",
      confidence: clamp01(dominant),
      scores: {
        zh: han / total,
        ja: kana / total,
        ko: hangul / total,
        ru: cyrillic / total,
        ar: arabic / total,
        en: latin / total,
      },
    }
  }

  private detectLatinLanguage(text: string): LanguageDetection {
    const words = (text.toLowerCase().match(WORD_RE_LATIN) ?? [])
    const wordCount = words.length || 1
    const wordSet = new Map<string, number>()
    for (const w of words) wordSet.set(w, (wordSet.get(w) ?? 0) + 1)

    const scores: Partial<Record<LanguageCode, number>> = {}

    for (const lang of ["en", "fr", "es", "de", "pt"] as const) {
      const feat = LATIN_LANG_FEATURES[lang]
      let score = 0

      // 停用词命中（按出现次数）
      for (const sw of feat.stopwords) {
        const c = wordSet.get(sw)
        if (c) score += c
      }
      // 归一化到“每词命中率”
      score = score / wordCount

      // 变音符号加分
      const diacriticHits = lang === 'en' ? 0 : (text.match(feat.diacritics) ?? []).length
      score += Math.min(diacriticHits / Math.max(wordCount, 1), 0.5) * 0.5

      // 特征字符直接加分（如 ñ、ß、ç）
      const specialHits = lang === 'en' ? 0 : (text.match(feat.specialChars) ?? []).length
      score += Math.min(specialHits / Math.max(wordCount, 1), 0.5) * 0.3

      scores[lang] = score
    }

    // 英文作为基线：若其它语言都无明显特征，拉丁文本归 en
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]) as [
      LanguageCode,
      number,
    ][]
    const [topLang, topScore] = ranked[0]

    // 没有任何语言有显著得分 → 默认英文（纯拉丁无变音通常就是英文）
    if (topScore < 0.05) {
      return { language: "en", confidence: 0.5, scores }
    }

    // 两个语言得分接近 → mixed
    const second = ranked[1]
    if (second && topScore - second[1] < 0.03 && topScore < 0.3) {
      return { language: "mixed", confidence: clamp01(topScore), scores }
    }

    const confidence = clamp01(topScore / (topScore + (second?.[1] ?? 0) + 0.001))
    return { language: topLang, confidence, scores }
  }

  // -------------------------------------------------------------------------
  // 主题分类
  // -------------------------------------------------------------------------

  detectTopic(text: string): Topic {
    const lower = text.toLowerCase()
    let best: Topic = "其他"
    let bestScore = 0

    for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS) as [
      Exclude<Topic, "其他">,
      string[],
    ][]) {
      let score = 0
      for (const kw of keywords) {
        const hits = countOccurrences(lower, kw.toLowerCase())
        if (hits > 0) score += hits * (1 + Math.min(kw.length, 6) / 10)
      }
      if (score > bestScore) {
        bestScore = score
        best = topic
      }
    }
    return best
  }

  // -------------------------------------------------------------------------
  // 高频词
  // -------------------------------------------------------------------------

  getKeywords(text: string, options: AnalyzeOptions = {}): WordFrequency[] {
    const topN = options.topN ?? 10
    const extra = new Set((options.extraStopwords ?? []).map((w) => w.toLowerCase()))
    const counter = new Map<string, number>()

    const add = (word: string) => {
      const w = word.toLowerCase()
      if (w.length < 2) return
      if (EN_STOPWORDS.has(w) || ZH_STOPWORDS.has(w)) return
      if (extra.has(w) || this.extraStopwords.has(w)) return
      counter.set(w, (counter.get(w) ?? 0) + 1)
    }

    for (const m of text.match(WORD_RE_LATIN) ?? []) add(m)
    for (const seg of text.match(ZH_SEGMENT_RE) ?? []) {
      if (seg.length <= 4) add(seg)
      else for (let i = 0; i < seg.length - 1; i++) add(seg.slice(i, i + 2))
    }

    return [...counter.entries()]
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
      .slice(0, topN)
  }
}

// ===========================================================================
// 工具
// ===========================================================================

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    count++
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}
