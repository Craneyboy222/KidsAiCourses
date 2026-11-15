/**
 * Real-people evidence analyser (spec 3.4, the Section 6 validation
 * paragraph, and decision D3).
 *
 * Until a specialist CSAM hash-matching provider is approved and enabled, a
 * course must not ask a learner to upload images or video of real people.
 * This module reads course copy one sentence at a time and reports the
 * sentences that ask for, or invite, that kind of media.
 *
 * How it decides, for each sentence:
 *   1. Find "mentions": phrases that describe media of a real person
 *      ("a selfie", "a photo of your friend", "film yourself").
 *   2. Drop a mention that the sentence rules out ("not a photo of a real
 *      person", "do not upload images or video of real people", "selfies
 *      will be rejected", "if a person is in shot, crop them out").
 *   3. Anything left is a finding.
 *
 * It errs towards flagging. A sentence that merely invites a selfie ("add a
 * photo of yourself if you like") is reported, because the upload would still
 * arrive. An author can always reword; a child's photo cannot be un-sent.
 *
 * Pure and dependency-free, so it can run in the CMS as the author types.
 */

export interface PeopleEvidenceFinding {
  /** The offending sentence, as written (trimmed). */
  sentence: string;
  /** The phrase inside it that describes media of a real person. */
  phrase: string;
}

// ───────────────────────────── Vocabulary ─────────────────────────────

const MEDIA =
  "(?:photo(?:graph)?s?|pictures?|pics?|images?|videos?|footage|films?|recordings?|clips?|screenshots?|screen recordings?|snaps?|shots?|selfies?|portraits?|gifs?|deepfakes?|face swaps?)";

/** "images or video", "photos, videos, or recordings" */
const MEDIA_LIST = `${MEDIA}(?:\\s*(?:,\\s*(?:or|and)\\b|,|/|&|\\bor\\b|\\band\\b)\\s*(?:an?\\s+|the\\s+)?${MEDIA})*`;

const LINK =
  "\\s+(?:of|showing|shows?|featuring|features?|containing|contains?|that\\s+(?:shows?|contains?|features?|includes?))\\s+";

/**
 * Words that may sit between "of" and the person. Deliberately excludes
 * "cartoon", "illustrated", "generated" and the like, so "a picture of a
 * cartoon person" is not a mention.
 */
const DETERMINERS =
  "(?:(?:a|an|the|some|any|one|two|three|several|other|another|more|each|every|all|both|real|actual|living|famous|your|my|our|their|own|best|favourite|little|big|older|younger|whole)\\s+)*";

const RELATIVES =
  "(?:friends?|mates?|family(?:\\s+members?)?|mum|mom|dad|parents?|carers?|brothers?|sisters?|siblings?|classmates?|teachers?|cousins?|gran|nan|grandparents?|boyfriend|girlfriend|neighbours?)";

const PERSON = `(?:you\\b(?!\\s+(?:made|designed|built|created|drew|wrote|coded)\\b)|yourself|yourselves|face|faces|${RELATIVES}|person|persons|people|someone|somebody|anyone|everybody|everyone|strangers?|humans?|kids?|child(?:ren)?|teen(?:ager)?s?|students?|pupils?|celebrit(?:y|ies)|footballers?|influencers?)`;

/** People who are unmistakably real, for the looser "shows …" pattern. */
const STRICT_PERSON = `(?:(?:(?:a|an|any|some|other)\\s+)?(?:real|actual)\\s+(?:people|persons?|faces?)|yourself|yourselves|your(?:\\s+own)?\\s+face|other\\s+people|another\\s+person|your\\s+${RELATIVES})`;

const CAPTURE_OBJECT = `(?:yourself|yourselves|your(?:\\s+own)?\\s+face|(?:(?:your|a|some|the|my|our)\\s+)?(?:(?:best|little|big|older|younger|whole)\\s+)?${RELATIVES}|(?:(?:\\d+|two|three|four|five|six|ten|some|several|a\\s+few|other|more)\\s+)?people|someone|somebody|strangers?|(?:a\\s+)?real\\s+(?:people|person)|a\\s+person)`;

const IN_SHOT_SUBJECT = `(?:you|yourself|(?:(?:a|any)\\s+)?real\\s+(?:person|people)|people|someone|somebody|anyone|(?:(?:your|a)\\s+)?${RELATIVES})`;

/**
 * No possessive after the person: "your friend's drawing" is about the
 * drawing. The exception is a possessive that still describes the person:
 * "your classmates' faces".
 */
const END = "\\b(?!'s?\\s+(?!(?:faces?|heads?|selfies?|photos?|pictures?|portraits?)\\b)\\w)";

/** Up to four words that are not themselves a negation, between a verb and what it acts on. */
const GAP = "(?:(?!(?:without|not|no|never|nor)\\b)[\\w'-]+\\s+){0,4}?";

const MENTION_PATTERNS: readonly RegExp[] = [
  // "a photo of yourself", "images or video of real people", "a screenshot showing your face"
  new RegExp(`\\b${MEDIA_LIST}${LINK}${DETERMINERS}${PERSON}${END}`, "g"),
  // "… that shows real people", "contains other people"
  new RegExp(`\\b(?:shows?|showing|contains?|containing|features?|featuring)\\s+${STRICT_PERSON}${END}`, "g"),
  // "your end card should show you waving", but not "we show you how"
  /\b(?:shows?|showing|features?|featuring)\s+you\b(?!\s+(?:how|what|where|why|when|that|the|a|an|your|which|if|whether)\b)/g,
  /\b(?:wav(?:e|es|ing)|smil(?:e|es|ing)|look(?:s|ing)?)\s+(?:at|into)\s+the\s+camera\b/g,
  // "add your photo to the About page", "take a picture with your friends"
  /\b(?:add|include|upload|attach|insert|put|use|submit|send|share)\s+your\s+(?:own\s+)?(?:photo(?:graph)?|picture|pic|portrait)\b(?!\s+of\b)/g,
  new RegExp(
    `\\b(?:take|taking|took|snap|grab|get)\\s+(?:(?:a|some|the)\\s+)?(?:quick\\s+)?(?:photo|picture|pic|video|shot)s?\\s+with\\s+(?:(?:your|a|some|my)\\s+)?(?:(?:best|little|big|older|younger|whole)\\s+)?(?:${RELATIVES}|people|someone)${END}`,
    "g",
  ),
  // Nouns that are media of a person by definition.
  /\bselfies?\b(?![- ](?:filter|camera|cam|mode|stick|app|lens|button|view|light)s?\b)/g,
  /\b(?:head ?shots?|mug ?shots?|face ?cams?|talking[- ]heads?|pieces? to camera|vlogs?|vlogging|video[- ]?(?:call|chat)s?)\b/g,
  /\b(?:profile|passport|school|id|family|class|team|group)\s+(?:photo(?:graph)?|picture|pic)s?\b/g,
  // "real-person likeness", "the likeness of a real person"
  /\breal[- ]person likeness(?:es)?\b/g,
  new RegExp(`\\blikeness(?:es)?\\s+of\\s+${DETERMINERS}${PERSON}${END}`, "g"),
  // "film yourself", "record your friends", "photograph people"
  new RegExp(
    `\\b(?:film|record|video|videotape|photograph|snap|shoot|capture|screenshot|screen-record)(?:s|ing|ed)?\\s+(?:a\\s+(?:quick\\s+|short\\s+)?(?:photo|video|picture|clip)\\s+of\\s+)?${CAPTURE_OBJECT}${END}`,
    "g",
  ),
  // "present your pitch on camera", "get your classmates on camera", "talk to the camera"
  new RegExp(
    `\\b(?:yourself|appear(?:s|ing)?|present(?:s|ing)?|talk(?:s|ing)?|speak(?:s|ing)?|perform(?:s|ing)?|danc(?:e|es|ing)|sing(?:s|ing)?|act(?:s|ing)?|reactions?|${RELATIVES}(?:'s)?|people|someone)\\s+(?:[\\w'-]+\\s+){0,4}?(?:on[- ]camera|on\\s+video|on\\s+film|on\\s+(?:the\\s+|your\\s+)?webcam|to\\s+(?:the\\s+)?camera)\\b(?!\\s+(?:permission|access|api|settings|view|mode|roll|preview|feed|input|app)\\b)`,
    "g",
  ),
  // "a short video introducing yourself"
  new RegExp(
    `\\b${MEDIA}\\s+\\w+ing\\s+(?:yourself|yourselves|you\\b(?!\\s+(?:how|what|where|why|when|that|the|a|an|your|which|if|whether)\\b)|your\\s+${RELATIVES}${END})`,
    "g",
  ),
  // "get your mum to try it and film her"
  /\b(?:film|record|video|photograph|snap)(?:s|ing|ed)?\s+(?:him|her)\b(?=\s*(?:[.,;!?)]|$)|\s+(?:and|or|as|while|when|doing|using|playing|trying|wearing)\b)/g,
  // "use your own face as the test image"
  /\b(?:use|using)\s+your\s+own\s+face\b|\byour(?:\s+own)?\s+face\s+as\b/g,
  // "one of you wearing it", "video their reactions"
  /\b(?:one|another)\s+of\s+(?:you|yourself)\s+\w+ing\b/g,
  /\b(?:video|film|record|photograph)(?:s|ing|ed)?\s+(?:their|his|her)\s+(?:reactions?|faces?)\b/g,
  // "clone a celebrity's face onto your video", "put your face on the poster"
  new RegExp(
    `\\b(?:clone|swap|put|use|add|paste|upload|film|record|capture|photograph|scan|include|show)(?:s|ing|ed)?\\s+${GAP}(?:${RELATIVES}|celebrit(?:y|ies)|someone|somebody|person|people|footballers?|influencers?)'s?\\s+(?:real\\s+)?faces?\\b`,
    "g",
  ),
  /\b(?:put|add|place|paste|include|insert|swap|clone)\s+your(?:\s+own|\s+real)?\s+face\b/g,
  // "record your voice and your face"
  new RegExp(
    `\\b(?:film|record|capture|photograph|scan|upload|screenshot)(?:s|ing|ed)?\\s+${GAP}your(?:\\s+own|\\s+real)?\\s+face\\b`,
    "g",
  ),
  // "show your face", "your face in the video"
  /\b(?:show|shows|showing|include|includes|including|reveal|reveals|revealing)\s+(?:us\s+|me\s+|off\s+)?your(?:\s+own|\s+real)?\s+face\b/g,
  /\byour(?:\s+own)?\s+face\s+(?:in|on)\s+(?:the\s+|your\s+)?(?:video|photo|picture|shot|camera|frame|screenshot|clip|recording)\b/g,
  // "a real person in shot", "you in the video", "people in the background"
  new RegExp(
    `\\b${IN_SHOT_SUBJECT}\\s+(?:(?:is|are|being|appear|appears|appearing|visible|clearly)\\s+){0,2}in\\s+(?:it|them|shot|frame|view|(?:the|your|that|this)\\s+(?:shot|frame|photo|picture|video|background|clip|image|screenshot|recording|footage))\\b`,
    "g",
  ),
  // "you appear in the video", "starring your friends"
  new RegExp(
    `\\b(?:you|yourself|(?:your\\s+)?${RELATIVES}|people|someone)\\s+(?:(?:must|should|will|can|could|to|need\\s+to|have\\s+to)\\s+)?(?:appear|appears|appearing|star|stars|starring|feature|features)\\s+in\\b`,
    "g",
  ),
  new RegExp(`\\b(?:starring|featuring)\\s+(?:you\\b|yourself|your\\s+${RELATIVES}|real\\s+people)`, "g"),
  // "pose for the photo", "ask a friend to model your design"
  /\bpos(?:e|es|ing)\s+for\b/g,
  new RegExp(
    `\\b(?:${RELATIVES}|someone|somebody)\\s+to\\s+(?:model|wear|pose|star|appear|act|feature|be\\s+in)\\b`,
    "g",
  ),
];

/** Phrases that look like a negation but are not one. Blanked out before step 2. */
const NOT_A_NEGATION =
  /\b(?:(?:don't|do not|never|not)\s+forget\b|(?:don't|do not)\s+(?:be\s+(?:afraid|shy|scared)(?:\s+to)?|hesitate\s+to|worry)|not\s+only|why\s+not|(?:can't|cannot)\s+wait|no\s+(?:problem|worries|doubt)|not\s+sure|if\s+not)\b/g;

/**
 * Negations with reach: they rule out a mention later in the same segment
 * ("do not upload images or video of real people").
 */
const STRONG_CUE =
  "not|no|never|none|don't|dont|do not|does not|doesn't|did not|didn't|must not|mustn't|should not|shouldn't|cannot|can't|can not|won't|will not|isn't|aren't|nor|neither";

/**
 * Words that rule out only what comes straight after them ("without a real
 * person in shot", "instead of a selfie"). "Remove the background and upload
 * a selfie" must still be flagged, so these have no reach.
 */
const DIRECT_CUE =
  "without|avoid(?:s|ing|ed)?|instead of|rather than|in place of|free of|free from|exclud(?:e|es|ing)|reject(?:s|ed|ing)?|ban(?:s|ned|ning)?|forbid(?:s|den)?|prohibit(?:s|ed)?|hide|hides|hiding|blur|blurs|blurring|blurred|mask|masks|masking|crop(?:s|ped|ping)?\\s+out|remove|removes|removing|delete|deletes|deleting|leave\\s+out|leaves\\s+out";

const PRE_CUE = new RegExp(`\\b(?:(${STRONG_CUE})|(${DIRECT_CUE}))\\b`, "g");

/** The few words allowed between a direct cue and the mention: "avoid using any real photos of people". */
const DIRECT_FILLER =
  /^\s*(?:(?:any|all|the|a|an|your|every|real|actual|other|more|uploading|using|including|submitting|sharing|sending|posting|adding|taking)\s+){0,3}$/;

/** Words between a negation and the mention that end the negation's reach: "do not upload anything but a selfie". */
const REACH_BREAKER = /\b(?:but|however|instead|just|only|simply|except|unless|then)\b/;

/** Words straight after a mention that rule it out: "selfies will be rejected". */
const POST_CUE = new RegExp(
  "^\\s*(?:[\\w'-]+\\s+){0,3}?(?:" +
    [
      "(?:is|are|was|were)\\s+(?:not|never)\\s+(?:allowed|accepted|permitted|ok|okay|needed|required|necessary|welcome)",
      "(?:isn't|aren't)\\s+(?:allowed|accepted|permitted|ok|okay|needed|required|necessary|welcome)",
      "(?:(?:must|should|can|may|will|shall)\\s*(?:not|never)|mustn't|shouldn't|can't|cannot|won't)\\s+be\\s+(?:uploaded|submitted|used|included|shown|shared|added|accepted|allowed|posted|sent|attached|in)",
      "(?:will\\s+be|are|is|gets?)\\s+(?:rejected|banned|forbidden|prohibited|removed|deleted|refused|blocked)",
      "(?:is|are)\\s+(?:off[- ]limits|against\\s+the\\s+rules)",
      "out\\s+of\\s+(?:shot|frame|view|(?:the|your)\\s+(?:shot|frame|picture|photo|video))",
    ].join("|") +
    ")\\b",
);

/** "If a real person is in shot, crop them out": a condition followed by a way to put it right. */
const CONDITION = /\b(?:if|when|whenever|where|unless|in case)\b[^,]*$/;
const REMEDY =
  /\b(?:crop|blur|retake|re-take|remove|delete|start again|choose another|swap|switch|replace|hide|cover|step out|move out|turn off|stop|report|rejected|refused|do not|don't|must not|mustn't|cannot|can't|never|(?:won't|will not) be accepted)\b/;

// ───────────────────────────── Text handling ─────────────────────────────

/**
 * No real sentence is this long. Longer runs of text are read in pieces, so
 * the time taken stays in proportion to the length of the text.
 */
const MAX_SENTENCE_CHARS = 1000;

function splitLong(sentence: string): string[] {
  const pieces: string[] = [];
  let rest = sentence;
  while (rest.length > MAX_SENTENCE_CHARS) {
    const window = rest.slice(0, MAX_SENTENCE_CHARS);
    const half = MAX_SENTENCE_CHARS / 2;
    // Prefer a break between clauses, so a "do not …" stays with what it rules out.
    const clause = Math.max(window.lastIndexOf(";"), window.lastIndexOf("—")) + 1;
    const space = window.lastIndexOf(" ");
    const cut = clause > half ? clause : space > half ? space : MAX_SENTENCE_CHARS;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  pieces.push(rest);
  return pieces;
}

/** Splits copy into sentences. Bullets and line breaks also end a sentence. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])["'”’)\]]*\s+|\s*\n+\s*/)
    .flatMap((sentence) => (sentence.length > MAX_SENTENCE_CHARS ? splitLong(sentence) : [sentence]))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * Lower-cases, straightens quotes and blanks Markdown marks. Every
 * replacement keeps the string the same length, so an index into the result
 * is also an index into the original sentence.
 */
function normalise(sentence: string): string {
  return sentence
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[*_`#>]/g, " ");
}

const blank = (value: string): string => " ".repeat(value.length);

interface Mention {
  start: number;
  end: number;
}

function findMentions(normalised: string): Mention[] {
  const mentions: Mention[] = [];
  for (const pattern of MENTION_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of normalised.matchAll(pattern)) {
      mentions.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return mentions.sort((a, b) => a.start - b.start || b.end - a.end);
}

/** A segment is the part of a sentence between brackets, dashes, colons and semicolons. */
function segmentBounds(text: string, mention: Mention): { start: number; end: number } {
  const isBoundary = (index: number): boolean => {
    const char = text[index];
    if (char === ";" || char === ":" || char === "(" || char === ")" || char === "—" || char === "–")
      return true;
    // A spaced hyphen is a dash; a hyphen inside a word is not.
    return char === "-" && text[index - 1] === " " && text[index + 1] === " ";
  };
  let start = 0;
  for (let i = mention.start - 1; i >= 0; i -= 1) {
    if (isBoundary(i)) {
      start = i + 1;
      break;
    }
  }
  let end = text.length;
  for (let i = mention.end; i < text.length; i += 1) {
    if (isBoundary(i)) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** True when a negation before the mention, in the same segment, rules it out. */
function ruledOutBefore(before: string, after: string): boolean {
  const cues = [...before.matchAll(PRE_CUE)];
  for (let i = cues.length - 1; i >= 0; i -= 1) {
    const cue = cues[i];
    if (!cue) continue;
    const between = before.slice(cue.index + cue[0].length);

    if (cue[2] !== undefined) {
      // A direct cue only counts when the mention is what it applies to.
      if (!DIRECT_FILLER.test(between)) continue;
      if (cue[0] === "without") {
        // "Do not submit without a selfie" asks for one.
        const earlier = cues[i - 1];
        const gap = earlier ? before.slice(earlier.index + earlier[0].length, cue.index) : "";
        const governed =
          earlier?.[1] !== undefined &&
          !gap.includes(",") &&
          gap.trim().split(/\s+/).filter(Boolean).length <= 4;
        if (governed) return false;
      }
      return true;
    }

    if (REACH_BREAKER.test(between)) return false;
    // A negation reaches across a comma only inside a list:
    // "do not upload images, selfies or video" but not "no, upload a selfie".
    const lastComma = between.lastIndexOf(",");
    if (lastComma !== -1) {
      const sinceComma = between.slice(lastComma + 1);
      const inList = /^\s*(?:or|and|nor)\b/.test(sinceComma) || /^\s*,?\s*(?:or|and|nor)\b/.test(after);
      if (!inList) return false;
    }
    return true;
  }
  return false;
}

function ruledOutAfter(after: string): boolean {
  return POST_CUE.test(after);
}

function ruledOutByCondition(beforeInSentence: string, afterInSentence: string): boolean {
  return CONDITION.test(beforeInSentence) && REMEDY.test(afterInSentence);
}

// ───────────────────────────── Public API ─────────────────────────────

/**
 * Returns one finding for each sentence in `text` that asks for, or invites,
 * images or video of real people.
 */
export function findRealPeopleRequirements(text: string): PeopleEvidenceFinding[] {
  const findings: PeopleEvidenceFinding[] = [];
  for (const sentence of splitSentences(text)) {
    const normalised = normalise(sentence).replace(NOT_A_NEGATION, blank);
    for (const mention of findMentions(normalised)) {
      const segment = segmentBounds(normalised, mention);
      const before = normalised.slice(segment.start, mention.start);
      const after = normalised.slice(mention.end, segment.end);
      const ruledOut =
        ruledOutBefore(before, after) ||
        ruledOutAfter(after) ||
        ruledOutByCondition(normalised.slice(0, mention.start), normalised.slice(mention.end));
      if (!ruledOut) {
        findings.push({ sentence, phrase: sentence.slice(mention.start, mention.end).trim() });
        break; // one finding per sentence is enough
      }
    }
  }
  return findings;
}

/** True when any sentence in `text` asks for images or video of real people. */
export function requiresRealPeopleMedia(text: string): boolean {
  return findRealPeopleRequirements(text).length > 0;
}
