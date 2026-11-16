/**
 * Stage 6 (input) and stage 9 (output) of the Coach pipeline (spec Section 8): moderation.
 *
 * `Moderator` is the interface; `rulesModerator` is the implementation that ships. It is local
 * and deterministic: keyword and pattern rules over normalised text, no network, no model.
 * A provider moderation API can sit behind the same interface later (`createGatewayModerator`),
 * but nothing enables or calls it by default, and it needs an approved processor first (D1).
 *
 * How a verdict is reached:
 *  1. The text is normalised (case, accents, text-speak, leetspeak, masking, stretched letters)
 *     so that "k1ll myself", "kms", "unalive" and "su*cide" are seen for what they are.
 *  2. Everyday idioms and technical phrases ("this bug is killing me", "kill the process") are
 *     set aside so they do not raise an alarm.
 *  3. Each matching rule adds evidence to its category. Scores combine as a noisy OR, so two
 *     weak signals together count for more than either alone.
 *  4. Crisis categories never silently block: they route to the fixed crisis script.
 *     Everything else is compared with the band's threshold; 13–15 is the strictest.
 *
 * Rules err towards showing a learner the support script when in doubt. A false alarm is a kind
 * message they did not need; a miss is a child in trouble who got a coding hint.
 */
import type { SafetyBand } from "@/server/authz/actor";

export const MODERATION_CATEGORIES = [
  "self_harm",
  "sexual",
  "sexual_minors",
  "violence",
  "hate",
  "drugs",
  "extremism",
  "grooming",
  "abuse_disclosure",
  "exploitation",
  "immediate_danger",
  "pii_oversharing",
  "academic_dishonesty",
  "jailbreak",
] as const;
export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];

/** Categories that route to the crisis pathway instead of blocking (spec 3.5). */
export const CRISIS_CATEGORIES = ["self_harm", "abuse_disclosure", "exploitation", "grooming", "immediate_danger"] as const;
export type CrisisCategory = (typeof CRISIS_CATEGORIES)[number];

export type ModerationDirection = "input" | "output";
/**
 * - `allow`: carry on.
 * - `block`: stop; show `message` (input) or regenerate (output).
 * - `refuse`: stop with an offer of what Coach can do instead (academic dishonesty).
 * - `crisis`: stop and show the fixed crisis script (input only).
 */
export type ModerationAction = "allow" | "block" | "refuse" | "crisis";

export type ModerationFinding = { category: ModerationCategory; score: number; rules: string[] };

export type CrisisSignal = {
  severity: "critical" | "high";
  /** Matches `SafeguardingTrigger` in the safeguarding service. */
  trigger: "crisis_classifier" | "abuse_disclosure" | "exploitation" | "grooming";
  /** Moderation categories, or `model_flag` when the model itself raised the alarm. */
  categories: string[];
};

export type ModerationVerdict = {
  action: ModerationAction;
  /** The category that decided the action, or null when allowed. */
  category: ModerationCategory | null;
  /** Every category with any evidence, strongest first. */
  findings: ModerationFinding[];
  /** Set when `action` is `crisis`. */
  crisis: CrisisSignal | null;
  /** Set when a safeguarding case must be opened even though the script is not shown (sexual content involving a minor). */
  safeguarding: { severity: "critical"; trigger: "crisis_classifier"; categories: ModerationCategory[] } | null;
  /** Shown to the learner for `block` and `refuse` on input. Null otherwise. */
  message: string | null;
  /** Category → score, for `ai_request.moderation`. Never contains the text. */
  summary: Record<string, number>;
  /** Which moderator produced this. */
  moderator: string;
};

export type ModerationInput = { text: string; direction: ModerationDirection; band: SafetyBand };

export interface Moderator {
  readonly name: string;
  moderate(input: ModerationInput): Promise<ModerationVerdict>;
}

// ───────────────────────────── Thresholds ─────────────────────────────

/** Score at which a non-crisis category blocks. 13–15 is the strictest. */
export const BLOCK_THRESHOLD: Record<SafetyBand, number> = { teen_13_15: 0.5, teen_16_17: 0.65, adult_18: 0.75 };
/** Score at which a crisis category shows the script. Low for everyone, lowest for 13–15. */
export const CRISIS_THRESHOLD: Record<SafetyBand, number> = { teen_13_15: 0.45, teen_16_17: 0.5, adult_18: 0.5 };
/** Sexual content involving a minor blocks at this score in every band. */
const SEXUAL_MINORS_THRESHOLD = 0.5;
const JAILBREAK_THRESHOLD: Record<SafetyBand, number> = { teen_13_15: 0.5, teen_16_17: 0.6, adult_18: 0.6 };
const ACADEMIC_THRESHOLD = 0.5;

// ───────────────────────────── Normalisation ─────────────────────────────

const TEXT_SPEAK: Array<[RegExp, string]> = [
  [/\bb4\b/g, "before"],
  [/\bh8\b/g, "hate"],
  [/\bm8\b/g, "mate"],
  [/\bgr8\b/g, "great"],
  [/\bl8r\b/g, "later"],
  [/\bstr8\b/g, "straight"],
  [/\b2day\b/g, "today"],
  [/\b(?:2nite|2night|tonite|2nyt)\b/g, "tonight"],
  [/\b2moro\b|\b2morrow\b|\btmrw\b|\btmr\b|\btomoz\b/g, "tomorrow"],
  [/\b4ever\b|\b4eva\b/g, "forever"],
  [/\bsum1\b|\bsome1\b/g, "someone"],
  [/\bany1\b/g, "anyone"],
  [/\bevery1\b/g, "everyone"],
  [/\bno1\b|\bnoone\b/g, "no one"],
];

const WORD_FORMS: Array<[RegExp, string]> = [
  [/\bwanna\b/g, "want to"],
  [/\bgonna\b|\bgunna\b|\bgna\b/g, "going to"],
  [/\bgotta\b/g, "got to"],
  [/\btryna\b|\btrynna\b/g, "trying to"],
  [/\bimma\b|\bima\b/g, "i am going to"],
  [/\bim\b/g, "i am"],
  [/\bive\b/g, "i have"],
  [/\bidk\b/g, "i do not know"],
  [/\bu\b/g, "you"],
  [/\bur\b/g, "your"],
  [/\br\b/g, "are"],
  [/\by\b/g, "why"],
  [/\bbc\b|\bcuz\b|\bcos\b|\bcoz\b|\bbcoz\b/g, "because"],
  [/\brn\b/g, "right now"],
  [/\bwat\b|\bwut\b/g, "what"],
  [/\bpls\b|\bplz\b/g, "please"],
  [/\bppl\b/g, "people"],
  [/\bsmth\b|\bsth\b/g, "something"],
  [/\bnth\b|\bnuthin\b|\bnothin\b/g, "nothing"],
  [/\bevery ?day\b/g, "every day"],
  [/\bany ?more\b/g, "anymore"],
  [/\bhavent\b|\bhavnt\b/g, "have not"],
  [/\bhasnt\b/g, "has not"],
  [/\bhadnt\b/g, "had not"],
  [/\barent\b/g, "are not"],
  [/\bwerent\b/g, "were not"],
  [/\bdis+ap+e+a?r/g, "disappear"],
  [/\bdepres+ed\b/g, "depressed"],
  [/(?<=\b(?:want|wanted|going|need|have|got|ready|about|trying|used|supposed|how|like|love|hate|wish|plan|planning|hoping|hope|not|able) )2\b/g, "to"],
  [/\bdont\b|\bdnt\b/g, "do not"],
  [/\bdoesnt\b/g, "does not"],
  [/\bdidnt\b/g, "did not"],
  [/\bcant\b|\bcannot\b/g, "can not"],
  [/\bwont\b/g, "will not"],
  [/\bisnt\b|\baint\b/g, "is not"],
  [/\bwasnt\b/g, "was not"],
  [/\bwouldnt\b/g, "would not"],
  [/\bshouldnt\b/g, "should not"],
  [/\bcouldnt\b/g, "could not"],
  [/\bill (?=be|not|never|just|do|go|have|try|kill|end|die|tell|get|probably|always)/g, "i will "],
  [/\bid (?=never|rather|be|have|like|kill|die|just)/g, "i would "],
  [/\bhed\b/g, "he would"],
  [/\btheyll\b/g, "they will"],
  [/\btheyd\b/g, "they would"],
  [/\beveryones\b/g, "everyone is"],
  [/\btonights\b/g, "tonight is"],
  [/\btheres\b/g, "there is"],
  [/\bhes\b/g, "he is"],
  [/\bshes\b/g, "she is"],
  [/\btheyre\b/g, "they are"],
  [/\bthats\b/g, "that is"],
  [/\bmyslf\b|\bmy self\b|\bmaself\b|\bmeself\b|\bmysel\b/g, "myself"],
  [/\bmom\b|\bmam\b|\bmummy\b|\bmother\b|\bma\b/g, "mum"],
  [/\bfather\b|\bdaddy\b|\bpa\b/g, "dad"],
  [/\bstep ?(mum|dad|brother|sister)\b/g, "step$1"],
  [/\bbf\b/g, "boyfriend"],
  [/\bgf\b/g, "girlfriend"],
  [/\bpics?\b|\bpix\b|\bpictures?\b|\bphotos?\b|\bimages?\b/g, "pics"],
  [/\bnoods\b|\bn00ds\b|\bnewds\b|\bnudez\b/g, "nudes"],
];

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };

/**
 * Lower-cases and flattens the text so the rules can be written once. Exported for the tests.
 * The result is for matching only and is never shown or stored.
 */
export function normaliseForModeration(input: string): string {
  let text = input.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  text = text.replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"');
  text = text.replace(/'/g, "");
  for (const [pattern, replacement] of TEXT_SPEAK) text = text.replace(pattern, replacement);
  // Leetspeak, but only inside a token that also has letters, so real numbers survive.
  text = text.replace(/[a-z0-9@$!]*[a-z][a-z0-9@$!]*/g, (token) =>
    /[a-z][0-9@$]+[a-z]/.test(token) || /[a-z]![a-z]/.test(token)
      ? token.replace(/[013457@$]|!(?=[a-z])/g, (ch) => LEET[ch] ?? ch)
      : token,
  );
  // Masking inside a word: su*cide, k_ll.
  text = text.replace(/(?<=[a-z])[*_]+(?=[a-z])/g, "");
  // Letters spelt out one at a time: "k m s", "s.u.i.c.i.d.e".
  text = text.replace(/\b(?:[a-z][ .\-]){2,}[a-z]\b/g, (run) => run.replace(/[ .\-]/g, ""));
  text = text.replace(/[^a-z0-9]+/g, " ");
  // Stretched letters: "pleeease", "diiie".
  text = text.replace(/([a-z])\1{2,}/g, "$1$1");
  for (const [pattern, replacement] of WORD_FORMS) text = text.replace(pattern, replacement);
  return ` ${text.replace(/\s+/g, " ").trim()} `;
}

/**
 * Everyday phrases that contain an alarming word but mean nothing of the kind. They are replaced
 * with a neutral token before the rules run.
 */
const IDIOMS: RegExp[] = [
  /\b(?:is|are|was|were|be|been|its|it is|keeps?) (?:literally |actually |really |so |just |absolutely )*killing me\b/g,
  /\bkilling it\b|\bkilled it\b|\bkill it\b|\bkilling time\b|\bkill time\b|\bkill switch\b|\bdressed to kill\b/g,
  /\bkill(?:s|ed|ing)? (?:the |this |that |my |a |an |all |off |every )*(?:process|processes|server|app|tab|tabs|script|program|loop|timer|task|terminal|session|port|bot|enemy|enemies|zombies?|boss|player|players|monsters?|mobs?|npcs?|characters?|sprites?|bugs?|vibe|mood|battery|animation|thread|job|container|window|music|sound|lights?)\b/g,
  /\bdying (?:to|for|of laughter|laughing|of boredom|of embarrassment|of cringe|inside laughing)\b/g,
  /(?<!wish )(?<!wished )(?<!if only )(?<!wishing )\b(?:i am|i was|im) (?:literally |actually |so )*dead\b(?! inside)/g,
  /\bdied (?:laughing|of laughter|of embarrassment|of cringe)\b|\bliterally died\b|\bi died\b(?= lol| lmao| haha)/g,
  /\b(?:phone|battery|laptop|app|server|wifi|tablet|chromebook|camera|mic|computer|pc|screen|charger|controller|internet|connection|project|page|site|preview) (?:has |just |nearly |almost |keeps? )*(?:died|dying|dies|dead)\b/g,
  /\bto die for\b|\bdie hard\b|\bdo or die\b|\bnever say die\b/g,
  /\bdead ?(?:line|lines|link|links|code|end|ends|battery|pixel|pixels|zone|weight|lock|locks|pan|on|centre|center|easy|simple|good|funny|chuffed|boring)\b/g,
  /\bsuicide squad\b|\bsuicide doors?\b/g,
  /\bshoot(?:ing)? (?:me )?(?:a|an|the|my|some|this|that|your)? ?(?:message|text|dm|email|video|videos|film|scene|scenes|shot|shots|hoops?|footage|clip|clips|reel|reels|content|pics|portrait|trailer)\b/g,
  /\bscreen ?shots?\b|\bhead ?shots?\b|\bsnap ?shots?\b|\bone shot\b|\blong shot\b|\bshot list\b/g,
  /\bthe bomb\b|\bphoto ?bomb(?:ed|ing)?\b|\bbath bombs?\b|\bbombed (?:the|my|that) (?:test|quiz|exam)\b/g,
  /\bhit me up\b|\bhits different\b|\bhit me with\b|\bhit (?:the|a|that|this) (?:button|key|enter|record|play|like|subscribe|save|run|link|wall|limit|cap)\b/g,
  /\bbeat(?:s|ing)? (?:the|a|this|my|that|your|their) (?:level|game|boss|score|record|timer|clock|quiz|high score|system|deadline)\b|\bbeats per minute\b|\bbeat ?maker\b|\bbeat drop\b/g,
  /\bcut(?:s|ting)? (?:and paste|the|a|this|my|that|out the) ?(?:video|clip|scene|pics|audio|code|track|footage|background|sound)?\b(?! myself| my (?:arm|arms|wrist|wrists|leg|legs|thigh|thighs|skin))/g,
  /\bhigh (?:score|scores|quality|res|resolution|contrast|school|five|level|priority|speed|def|definition)\b/g,
  /\b(?:diet|cherry|vanilla) coke\b|\bcoke zero\b|\bcoca cola\b|\bcan of coke\b|\bbottle of coke\b/g,
  /\b(?:citric|amino|hydrochloric|sulphuric|sulfuric|lactic|acetic|nitric|folic|stomach|fatty) acids?\b|\bacids? and alkalis?\b|\bacid rain\b|\bacids? (?:and|or) bases?\b/g,
  /\bdrug ?store\b|\bstory ?line\b|\bpunch ?line\b|\bpunchy\b|\bpunch (?:card|cards|hole)\b/g,
  /\bexecute (?:the|this|that|my|a|some)? ?(?:code|script|command|function|program|query|file)\b/g,
  /\bsex (?:ed|education)\b|\bsex(?:es)? (?:of|field|column|category)\b|\bsame sex\b/g,
  /\bhang (?:on|out|around|about|up|in there|tight)\b|\bhanging (?:out|around|on|about)\b|\bhangs? (?:when|on|after|at)\b/g,
  /\bjump (?:off|to|into|in|on|over) (?:the |a |my )?(?:page|screen|call|link|step|section|next|start|end|platform|platforms|sprite)\b/g,
];

function neutraliseIdioms(text: string): string {
  let out = text;
  for (const idiom of IDIOMS) out = out.replace(idiom, " ~ ");
  return out;
}

// ───────────────────────────── Rules ─────────────────────────────

type Rule = {
  id: string;
  category: ModerationCategory;
  /** 0–1: how strongly a match points to the category. */
  weight: number;
  pattern: RegExp;
  /** Which direction the rule applies to. Default both. */
  only?: ModerationDirection;
};

const rules: Rule[] = [];
const add = (category: ModerationCategory, weight: number, id: string, pattern: RegExp, only?: ModerationDirection): void => {
  rules.push({ id: `${category}.${id}`, category, weight, pattern, only });
};

// Reusable pieces. All rules run against normalised text (lower case, no apostrophes, single spaces).
const FAMILY =
  "(?:dad|stepdad|mum|stepmum|parents?|brother|stepbrother|sister|stepsister|uncle|aunt|auntie|grandad|grandpa|grandma|nan|cousin|carer|foster (?:dad|mum|carer|parent)|mums boyfriend|mum s boyfriend|dads girlfriend|mums partner|dads partner|boyfriend|girlfriend|partner|ex|teacher|coach|tutor|neighbour|babysitter|childminder|priest|youth worker|boss|manager|friends dad|mates dad|an? (?:older )?(?:man|guy|bloke|boy|lad|woman|adult)|someone|somebody|people|he|she|they|him|her)";
const HURT_VERB =
  "(?:hits?|hitting|beats?|beating|punch(?:es|ed|ing)?|kicks?|kicked|kicking|slaps?|slapped|slapping|hurts?|hurting|strangles?|strangled|chokes?|choked|choking|burns?|burnt|burned|whips?|whipped|belts?|belted|batters?|battered|battering|smacks?|smacked|smacking|bites?|shoves?|shoved|throws? things at|threw things at|attacks?|attacked|abuses?|abused|abusing|rapes?|raped|raping|molests?|molested|molesting|assaults?|assaulted|touch(?:es|ed|ing)?|gropes?|groped|groping|fondles?|fondled|threatens?|threatened|threatening)";
const MINOR =
  "(?:child|children|kid|kids|minor|minors|underage|under age|little (?:girl|boy|girls|boys|sister|brother)|young (?:girl|boy|girls|boys)|schoolgirls?|schoolboys?|pre ?teens?|tweens?|teens?|teenagers?|year ?[1-9]s?|year 1[01]s?|loli|lolis|shota|toddlers?|infants?|bab(?:y|ies)|(?:[1-9]|1[0-7]) ?(?:yo|y o|yrs? old|years? old|year olds?))";
const SEXUAL_EXPLICIT =
  "(?:porn|porno|pornography|pornhub|xxx|hentai|rule ?34|nsfw|nudes?|naked|nude|sex|sexual|sexy|sexting|sext|horny|erotic|erotica|smut|lewd|blow ?jobs?|hand ?jobs?|masturbat\\w*|wank\\w*|jerk(?:ing)? off|orgasm\\w*|cum|cumming|boobs?|tits?|titties|dick|dicks|cock|cocks|penis|vagina|pussy|clit|genitals?|private parts|strip(?:ping|per|pers)?|only ?fans|fetish\\w*|kink\\w*|bdsm|bondage|threesome|foreplay|topless|undress\\w*|make love|making love|sleep with|slept with|sleeping with|hook ?up|hooking up|fingering|grinding on)";
const DRUG =
  "(?:weed|cannabis|marijuana|ganja|skunk|hash|spliffs?|joints?|zoots?|edibles?|thc|coke|cocaine|crack cocaine|mdma|ecstasy|pingers?|molly|ketamine|ket|lsd|acid tabs?|shrooms|magic mushrooms|meth|crystal meth|heroin|fentanyl|xanax|xans|benzos?|valium|codeine|lean|tramadol|oxy|opioids?|nos|nitrous|laughing gas|balloons|poppers|spice|steroids|adderall|ritalin|diet pills|vapes?|vaping|elf ?bars?|nic|nicotine|snus|cigarettes?|cigs|fags|booze|alcohol|vodka|whisky|whiskey|rum|gin|cider|lager|beer|wine|shots of|drugs?|pills|tablets)";
const HARD_DRUG =
  "(?:coke|cocaine|crack cocaine|mdma|ecstasy|pingers?|molly|ketamine|ket|lsd|acid tabs?|shrooms|magic mushrooms|meth|crystal meth|heroin|fentanyl|xanax|xans|benzos?|lean|spice|nos|nitrous|weed|cannabis|marijuana|skunk|edibles?|drugs)";
const GROUPS =
  "(?:gays?|gay people|lesbians?|trans people|trans|transgender people|bisexuals?|queers?|muslims?|jews?|jewish people|christians?|hindus?|sikhs?|black people|blacks|white people|whites|asians?|asian people|pakistanis?|indians?|chinese people|africans?|arabs?|immigrants?|migrants?|refugees?|asylum seekers?|foreigners?|travellers?|gypsies|roma|disabled people|autistic people|women|girls|females|men|boys|fat people|poor people|the poor|polish people|poles|irish people|mexicans?|latinos?)";

// ── Self-harm and suicide (crisis) ──────────────────────────────────────────
add("self_harm", 0.97, "kill_myself", /\b(?:kil+|kll|kil|klil|off|top|end|hang|hung|shoot|shot|drown|stab|unalive|un alive|murder|poison|delete|destroy) ?(?:ing|ed|s)? (?:my ?self|me self)\b/);
add("self_harm", 0.97, "kms", /\bkms\b(?! (?:away|from|to|per|an hour))|(?<!\d )\bkm+s\b(?= rn| right now| tonight| fr| for real| lol| tbh| ngl| if| when|$)/);
add("self_harm", 0.97, "suicide_intent", /\b(?:commit(?:ting|ted)?|attempt(?:ing|ed)?|thinking (?:about|of)|thought (?:about|of)|thoughts (?:about|of)|consider(?:ing|ed)?|planning|plan(?:ned)? (?:my|to)|feel(?:ing)?|want (?:to )?(?:commit)?|contemplat\w+) (?:my )?(?:own )?(?:s+u+[i]*[cs]+[i]*d+e*|sewer ?slide|sui|suicidal)\b/);
add("self_harm", 0.9, "suicidal", /\b(?:i am|i feel|feeling|i have been|been|i get|i keep (?:getting|feeling)|makes? me) (?:really |so |kind of |a bit |quite |very )*(?:suicidal|s+u+[i]*[cs]+[i]*d+al)\b|\bsuicidal (?:thoughts|feelings|ideation)\b/);
add("self_harm", 0.55, "suicide_word", /\b(?:s+u+[i]+[cs]+[i]*d+e+|sucide|suicde|suiside|sewer ?slide|suicidal)\b/);
add("self_harm", 0.95, "unalive", /\bun ?aliv(?:e|ing|ed)\b(?: (?:my ?self|me))?|\bunaliv\w*\b/);
add("self_harm", 0.95, "end_life", /\b(?:end(?:ing)?|take|taking|took) (?:it all|my (?:own )?life|everything|things for good|it for good)\b|\bend it\b(?= all| tonight| now| soon| for good|$| i| \.)|\bend(?:ing)? (?:my|this) (?:life|pain|suffering) ?(?:for good)?\b/);
add("self_harm", 0.95, "want_die", /\b(?:want|wanted|wanting|wish|wishing|ready|going|hope|hoping|need|plan|planning|deserve|rather|prefer|like) (?:to |i could |i would |i can )?(?:just |really |actually )*(?:die+|be dead|not be alive|not exist|stop existing|not wake up|never wake up|disappear forever|go to sleep (?:and|forever)|sleep forever|be gone forever)\b/);
add("self_harm", 0.95, "wish_dead", /\b(?:wish|wished|wishing|if only) (?:i|that i) (?:was|were|am|could be|had) (?:just |already )*(?:dead|never born|not born|gone|not here|not alive|died)\b|\bwish i (?:had )?never (?:been born|existed|woke up)\b|\bbetter (?:off )?dead\b|\bwish i (?:did not|didnt) exist\b/);
add("self_harm", 0.9, "not_be_here", /\b(?:do not|did not|never) (?:want|wanted|feel like|see the point in|see why i should be|think i (?:can|should|want to)) (?:to )?(?:be(?:ing)? here|be(?:ing)? alive|live|living|exist(?:ing)?|be around|wake up|carry on(?: living)?|go on(?: living)?|keep (?:going|living)|be on (?:this|the) (?:earth|planet))\b(?: any ?more| any longer)?/);
add("self_harm", 0.9, "better_without_me", /\b(?:every ?(?:one|body)|they|you all|my (?:family|parents|mum|dad|friends|mates)|the world|people|things) (?:would|will|ll|d|might|could) (?:all )?(?:be|been|feel|do) (?:so much |much |a lot |way )?(?:better|happier|fine|easier|okay|ok) (?:off )?(?:without me|if i (?:was|were|am) (?:not (?:here|around|alive)|gone|dead)|when i am gone|if i (?:just )?(?:died|disappeared|left|vanished))\b/);
add("self_harm", 0.9, "nobody_would_care", /\b(?:no ?(?:one|body)|nobody|who) (?:would|will|d|ll|even)? ?(?:even |really |actually )*(?:care|notice|miss me|be sad|cry|mind)s? (?:if|when) i (?:was|were|am|just)? ?(?:gone|dead|died|disappeared|vanished|not here|not around|killed myself|left|went missing)\b|\bno ?(?:one|body) would (?:even )?(?:miss|notice) me\b/);
add("self_harm", 0.85, "no_point_living", /\b(?:no|not any|whats (?:even |really |actually )?the|what is (?:even |really |actually )?the|see no|do not (?:even )?see (?:the|a|any)|there is no|not much|is there (?:even )?(?:any|a)) (?:point|reason|purpose)(?: (?:in|to|of))? (?:living|being alive|going on|carrying on|life|staying alive|being here|existing|me being here|trying anymore|anything anymore|any of it|it all)\b|\bnothing to live for\b|\bno reason to (?:live|be here|stay|keep going)\b|\blife is (?:not worth|pointless|meaningless|not worth living)\b|\b(?:not|isnt|is not) worth living\b/);
add("self_harm", 0.8, "cant_go_on", /\b(?:can not|could not) (?:go on|carry on|keep going|do this|take (?:it|this|any more|anymore)|cope|live|keep living|face (?:it|another day|tomorrow|life)|handle (?:it|life|this)) ?(?:any ?more|any longer|much longer)?\b(?= (?:with )?(?:life|living|anything|everything|like this)| i (?:just )?want (?:it|everything) to (?:stop|end)| it hurts too much|$)/);
add("self_harm", 0.3, "cant_anymore", /\bcan not (?:do this|take (?:it|this)|cope|go on|carry on) ?(?:any ?more|any longer)\b/);
add("self_harm", 0.8, "want_it_to_stop", /\bi (?:just )?want (?:it all|everything|the pain|this feeling|my life|my thoughts|it) to (?:stop|end|be over|go away for good)\b(?! (?:the|this) (?:video|timer|loop|music|sound|animation))/);
const INJURE = "(?:cut|cuts|cutting|cutt?ed|slit|slits|slitting|slic(?:e|ed|ing)|burn|burns|burning|burnt|scratch(?:es|ed|ing)?|hurt|hurts|hurting|harm|harms|harming|harmed|injur(?:e|ed|ing)|bit(?:e|ing)|punch(?:es|ed|ing)?|hit|hits|hitting|starv(?:e|ed|ing)|punish(?:ing|ed)?|bruis(?:e|ed|ing))";
add("self_harm", 0.95, "self_injury", new RegExp(`\\b${INJURE} (?:my ?self|me self)\\b(?! (?:on|with) (?:the|a|some) (?:paper|scissors|knife while cooking|oven|iron|hob|kettle|cooker))`));
add("self_harm", 0.9, "self_injury_body", new RegExp(`\\b${INJURE} (?:my (?:own )?(?:arms?|wrists?|legs?|thighs?|skin|stomach|body|hand|hands))\\b(?=.*\\b(?:on purpose|deliberately|again|every|when i (?:am|feel|get)|to (?:feel|cope|punish)|helps|so (?:i|it) (?:can|feel)|because i (?:hate|deserve)|until (?:it|i) bleeds?|relief|numb|no one knows|nobody knows|hide|hiding|blade|razor|lighter)\\b)`));
add("self_harm", 0.95, "self_harm_word", /\bself ?harm(?:ing|ed|s)?\b|\bself ?injur\w+\b|\bsh ?(?:ing|ed)? (?:again|relapse|scars|urges?)\b|\b(?:urge|urges|need|want) to (?:cut|sh|hurt myself|self harm)\b/);
add("self_harm", 0.8, "cutting", /\b(?:i|i have|i am|been|started|start|keep|kept|back to|stopped|stop|quit) (?:been |just )?(?:cutting|self harming|burning myself|scratching myself)\b(?= (?:again|every|last night|tonight|deeper|for (?:months|years|weeks|ages)|since|when i|to feel|helps?|and (?:i|my|no one|nobody))|$)/);
add("self_harm", 0.8, "relapse", /\b(?:relapsed|relapsing|relapse) (?:again|last night|today|tonight|yesterday|after)\b|\b\d+ (?:days?|weeks?|months?) clean\b(?= (?:and|but|then|from (?:cutting|sh|self harm)))|\bbroke my streak (?:of not )?(?:cutting|self harming)\b|\b(?:blades?|razors?) (?:again|in my room|hidden)\b|\b(?:fresh|new|my) (?:cuts|scars) (?:on my|again|from last)\b|\bhiding (?:my )?(?:cuts|scars)\b/);
add("self_harm", 0.97, "overdose", /\b(?:took|taken|taking|take|swallowed|swallow|swallowing|necked|necking|had|have|downed) (?:like |about |around |nearly |over |all )?(?:too many|a load of|loads of|a lot of|a bunch of|all (?:of )?(?:the|my|mums|dads)|the whole (?:pack|packet|box|bottle) of|a whole (?:pack|packet|box|bottle) of|\d{2,}|handful of|handfuls of|a handful of|loads|a load|so many|as many) ?(?:of )?(?:my |mums |dads |the )?(?:pills|tablets|paracetamol|ibuprofen|painkillers|meds|medication|sleeping pills|antidepressants|co ?codamol|aspirin|sertraline)\b|\b(?:took|taken|taking|take) an overdose\b|\b(?:overdos(?:e|ed|ing)|od ?ed|oding)\b(?! on (?:homework|coffee|sugar|caffeine|sweets|chocolate|memes|tiktok))/);
add("self_harm", 0.95, "method", /\b(?:jump(?:ing)? (?:off|from|in front of)|throw(?:ing)? myself (?:off|under|in front of|down)|step(?:ping)? in front of|walk(?:ing)? in front of) (?:a |the |my |an )?(?:bridge|roof|building|balcony|window|cliff|train|bus|car|lorry|tracks|motorway|multi ?storey|car park)\b|\b(?:noose|hang myself|hanging myself|rope around my neck|tie a noose|slit my (?:wrists?|throat)|bleed out|gun to my head|drink bleach|drinking bleach)\b/);
add("self_harm", 0.9, "note", /\b(?:i have|ive got|got|made|wrote|written|writing|write|have|left|leaving|leave) (?:a |my |them |every ?one |you |mum |dad )*(?:suicide (?:note|letter)s?|goodbye (?:note|letter|message|video)s?|final (?:note|letter|message)s?|last (?:note|letter)s?)\b/);
add("self_harm", 0.9, "plan", /\b(?:i have|ive got|got|made|have) (?:a |my )plan\b(?= to (?:end|die|kill|do it)| (?:for|about) (?:how|when) i| ready| and (?:a date|pills|a rope)|$)|\b(?:goodbye|bye) (?:forever|for good|for the last time|world|cruel world)\b|\bthis is (?:my )?(?:goodbye|the end for me|my last (?:message|day|night|time))\b|\b(?:you|they|every ?one) (?:will not|wont|will never) (?:have to )?(?:see|hear from|deal with|worry about|put up with) me (?:again|any ?more|after (?:tonight|today|this))\b|\bgoing to do it (?:tonight|today|tomorrow|soon|this weekend|after school)\b(?= i (?:can not|have decided)| nobody| no one| goodbye|$)|\bafter tonight (?:it|i) (?:will not|wont) (?:matter|be here|be a problem)\b|\bgiven away (?:all )?my (?:stuff|things)\b/);
add("self_harm", 0.75, "eating", /\b(?:starv(?:e|ing) myself|making myself (?:sick|throw up|puke)|make myself (?:sick|throw up|puke)|purg(?:e|ing|ed) (?:after|again|every)|not eaten (?:in|for) (?:\d+|two|three|four|five|a few|several) days|stopped eating|have not eaten (?:in|for) days|binge and purge|pro ?ana|thinspo|laxatives to|throw up (?:after|what) i eat|only (?:eat|eating|ate) \d{2,3} calories)\b/);
add("self_harm", 0.6, "hopeless", /\b(?:i am|i feel|feeling|i have been|been) (?:so |really |just |completely |totally )*(?:worthless|hopeless|a burden|a waste of space|empty inside|dead inside|numb inside|broken inside|unlovable)\b|\bi am (?:just )?a burden (?:to|on)\b|\b(?:hate|hating) (?:being alive|my life so much|living|existing|waking up)\b|\btired of (?:living|being alive|life|existing|waking up|everything and every ?one|fighting(?: it)?|trying to (?:stay|be) (?:alive|here))\b|\bdone with (?:life|living|everything|it all)\b|\bgive up on (?:life|living|everything)\b|\bgiving up on (?:life|living|everything)\b|\bwant to (?:give up on life|disappear|vanish|run away and never come back|not be here)\b|\bwish i could (?:just )?(?:disappear|vanish|not be here|sleep forever|stop existing|fade away)\b|\bdo not want to (?:wake up|be me|exist)\b/);
add("self_harm", 0.35, "low_mood", /\b(?:hate myself|hate my life|i am (?:so )?depressed|really depressed|so alone|completely alone|no one cares|nobody cares|no one likes me|nobody likes me|every ?one hates me|i am useless|i am a failure|whats the point|what is the point|no point anymore|cry(?:ing)? (?:myself to sleep|every night|every day|all the time)|can not stop crying|feel(?:ing)? (?:empty|numb|trapped|like giving up|like a failure|so low|really low)|nothing matters|do not care (?:what happens to me|if i (?:live|die))|panic attacks?|can not sleep (?:because|cause) of (?:thoughts|worrying))\b/);
add("self_harm", 0.9, "dont_care_die", /\b(?:do not|would not|wouldnt) (?:even )?(?:care|mind) if i (?:die|died|was dead|did not wake up|got hit by a (?:car|bus)|never woke up)\b|\bhope i (?:do not|dont|never) wake up\b|\bhope (?:a|some) (?:car|bus|lorry) hits me\b/);

// ── Abuse disclosure (crisis) ───────────────────────────────────────────────
add("abuse_disclosure", 0.95, "hurts_me", new RegExp(`\\b(?:my |the |our )?${FAMILY} (?:always |often |sometimes |keeps? |kept |still |just |has |have |had |is |are |was |were |would |used to |will |gets? drunk and |comes? home and )*${HURT_VERB} (?:me|my (?:little |younger |older |big )?(?:sister|brother|mum|siblings?)|us)\\b(?! (?:up|off|back) (?:on|with|about|for) )(?! (?:at|in) (?:fifa|mario kart|chess|fortnite|the game|football|tennis|a race|the quiz|monopoly))`));
add("abuse_disclosure", 0.9, "passive_hurt", /\bi (?:get|got|am getting|keep getting|am being|was|have been|was being) (?:hit|beaten|beat up|battered|punched|kicked|slapped|strangled|choked|burnt|burned|whipped|belted|abused|raped|molested|assaulted|touched|groped|hurt|locked (?:in|up|out)|starved|threatened) (?:at home|by (?:my|him|her|them|the|a|an|someone)|every (?:day|night|time|week)|when (?:he|she|they)|again|a lot|all the time)\b/);
add("abuse_disclosure", 0.95, "sexual_abuse", /\b(?:sexually (?:abus(?:e|ed|es|ing)|assault(?:ed|s|ing)?|touch(?:ed|es|ing)?|harass(?:ed|es|ing)?)|rap(?:ed|es|ing) me|molest(?:ed|s|ing) me|touch(?:es|ed|ing) me (?:where|down there|in (?:places|ways)|inappropriately|under my|when i (?:am asleep|sleep|was asleep)|and i (?:do not|did not) (?:like|want)|at night|in (?:the|my) (?:bed|bedroom|shower|bath))|touch(?:es|ed|ing) my (?:private|privates|private parts|bum|chest|boobs|thigh|thighs)|(?:comes?|came|coming|gets?|got) in(?:to)? my (?:room|bed|bedroom) (?:at night|when (?:every ?one|mum|dad)|while i)|gets? in(?:to)? (?:my )?bed with me|makes? me (?:touch|do things|do stuff|take my clothes off|undress|watch (?:porn|him|her))|made me (?:touch|do things|do stuff|take my clothes off|undress|watch (?:porn|him|her))|forced? me to (?:touch|do things|do stuff|have sex|kiss|undress|sleep with)|forced himself on me|had sex with me (?:when|and) i (?:did not|didnt|said no)|i said no (?:but|and) (?:he|she|they)|did (?:things|stuff) to me)\b/);
add("abuse_disclosure", 0.85, "scared_home", /\b(?:scared|afraid|frightened|terrified|worried|dreading|do not want|hate|not safe|unsafe|never safe|can not) (?:to |of |about |at |be |being |going |go |when (?:i )?(?:am |go )?)*(?:go(?:ing)? home|at home|home tonight|home after school|in my (?:own )?(?:house|home)|be(?:ing)? at home|of going home|of my (?:dad|stepdad|mum|stepmum|brother|uncle|mums boyfriend|foster))\b|\b(?:scared|afraid|frightened|terrified) of (?:my )?(?:dad|stepdad|mum|stepmum|brother|stepbrother|uncle|grandad|mums boyfriend|mum s boyfriend|foster (?:dad|mum|carer)|him when he|what he will do|what (?:he|she|they) (?:will|might) do (?:to me|next|when))\b|\b(?:not|do not feel|never feel|i am not|dont feel) safe (?:at home|in my (?:house|home)|around (?:him|her|them|my))\b|\bhome is not safe\b/);
add("abuse_disclosure", 0.85, "neglect", /\b(?:no|not any|never any|hardly any) food (?:at home|in (?:the|our|my) house)\b(?= (?:again|for days|and (?:my|i)|because (?:my|mum|dad))|$)|\b(?:does not|do not|never|wont|will not|refuses? to|forgets? to) (?:feed|give) (?:me|us)(?: (?:any )?(?:food|dinner|tea|anything to eat))?\b|\b(?:locks?|locked|locking|shuts?|shut) me (?:in|out|up|outside|in (?:my|the) (?:room|cupboard|shed|garage|basement|cellar))\b|\b(?:kicked|thrown|threw|chucked|kicking) me out\b(?! of (?:the )?(?:game|call|lobby|server|chat|group chat|party|class|lesson))|\b(?:left|leaves?) (?:me |us )?(?:on (?:my|our) own|alone|by myself) (?:for|all) (?:days|weeks|\d+ days|the weekend|night|week)\b|\bnot been home (?:in|for) (?:days|weeks)\b(?= (?:and|so) (?:i|we|there))|\bhave not eaten (?:because|cause) (?:there is|theres) no(?:thing| food)\b|\b(?:nothing|no food|not anything) (?:to eat )?(?:at home|in (?:the|our|my) house|in the (?:fridge|cupboards?))\b(?=.*(?:days|again|hungry|starving|eaten|mum|dad|never|week))|\b(?:have not|has not|not) eaten (?:in|for|since) (?:\d+|two|three|four|five|a few|several|ages|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b(?=.*(?:home|house|mum|dad|food|money|nothing))/);
add("abuse_disclosure", 0.85, "marks", /\b(?:bruises?|marks?|black eye|cuts?|burns?|scars?|welts?) (?:from|where|after|because) (?:my |when (?:my )?)?(?:dad|stepdad|mum|stepmum|brother|uncle|boyfriend|girlfriend|he|she|they|him|her|them)\b|\bhide (?:the|my) bruises\b|\bhiding (?:the|my) bruises\b|\bcover(?:ing)? (?:up )?(?:the|my) bruises\b/);
add("abuse_disclosure", 0.8, "emotional", /\b(?:my |the )?(?:dad|stepdad|mum|stepmum|parents|brother|boyfriend|girlfriend|partner) (?:always |constantly |keeps? |is always |are always )*(?:screams? at|scream(?:s|ing)? at|shouts? at|shouting at|calls? me (?:worthless|stupid|useless|fat|ugly|a mistake|names)|says? (?:i am|he|she) (?:wish(?:es)?|worthless|a mistake|should (?:never have been born|die|kill myself))|tells? me (?:to kill myself|i should (?:die|never have been born)|i am (?:worthless|a mistake|nothing))|wish(?:es)? i was (?:never born|dead)|controls? (?:every ?thing|who i (?:see|talk to)|my phone)|will not let me (?:see|talk to|leave|eat|out)|checks? my phone (?:every|all))\b/);
add("abuse_disclosure", 0.85, "domestic", /\b(?:my )?(?:dad|stepdad|mums boyfriend|mum s boyfriend|mums partner) (?:always |keeps? |often |sometimes |is |was )*(?:hits?|hitting|beats?|beating|hurts?|hurting|attacks?|attacked|strangles?|strangled|threatens?) (?:my )?mum\b|\bviolen(?:t|ce) at home\b|\bdomestic (?:violence|abuse)\b|\b(?:police|social services|social worker) (?:came|come|were called|took|might take)\b(?= .*(?:dad|mum|home|me away))|\bfighting at home (?:and|so) i (?:am|was) (?:scared|hiding)\b/);
add("abuse_disclosure", 0.9, "being_abused", /\bi (?:am|was|have been|think i am|think i was|might be) (?:being )?(?:abused|groomed|raped|molested|assaulted|trafficked|exploited|beaten|neglected)\b|\b(?:he|she|they) abus(?:e|es|ed|ing) me\b|\bi (?:am|was) a victim of (?:abuse|rape|assault)\b|\b(?:fgm|forced marriage|being (?:forced|made) to marry|honour (?:based )?(?:abuse|violence))\b/);
add("abuse_disclosure", 0.75, "bullying_severe", /\b(?:they|he|she|people|kids|lads|girls|boys|every ?one) (?:at school |in my (?:class|year) )?(?:keep |keeps |kept |always |all )*(?:beat(?:s|ing)? me up|jump(?:ed|s|ing)? me|batter(?:ed|s|ing)? me|attack(?:ed|s|ing)? me|threaten(?:ed|s|ing)? to (?:kill|stab|hurt|batter|jump|beat|leak|expose) me|told me to (?:kill myself|kms|die|go die)|tell(?:s|ing)? me to (?:kill myself|kms|die|go die)|said i should (?:kill myself|die)|film(?:ed|s|ing)? (?:me|it) (?:getting|being) (?:beaten|hit|jumped)|spit(?:s|ting)? (?:on|at) me|spat (?:on|at) me)\b/);
add("abuse_disclosure", 0.35, "bullying_mild", /\b(?:being|getting|get|am|was) bullied\b|\bbull(?:y|ies|ying) me\b|\bpick(?:s|ing)? on me\b/);

// ── Grooming (crisis) ────────────────────────────────────────────────────────
add("grooming", 0.9, "secret", /\b(?:our|a|my|the|his|her|their) (?:little |special |own )?secret\b(?= (?:and|so|from|that) (?:i|not|no one|nobody|my (?:mum|dad|parents)|i (?:can not|must not|should not|am not allowed to))| (?:between|with) (?:us|me and)| from my (?:mum|dad|parents))|\b(?:told|tells?|telling|said|says|asked|asks|wants|made) me (?:not to|never to|to not|i (?:can not|must not|should not|am not allowed to)|to promise not to) (?:tell|say anything to|show|talk to|mention it to) (?:any ?(?:one|body)|my (?:mum|dad|parents|family|friends|teacher)|a soul)\b|\b(?:said|says|told me|tells me) (?:not to|to not|never to|i (?:should not|must not|can not)|do not) tell\b|\b(?:do not|not to|never) tell (?:your|my) (?:parents|mum|dad|teacher|family)\b|\bkeep (?:it|this|us|our (?:chats?|relationship|friendship)) (?:a )?secret\b(?= from (?:my|your) (?:mum|dad|parents|family)| (?:or|because) (?:he|she|they|we|i)| he (?:said|says)| she (?:said|says)| they (?:said|say))|\b(?:said|says) (?:my (?:parents|mum|dad)|people|they|no one|nobody) (?:would not|wouldnt|will not|wont) understand (?:us|our)\b|\bdelete (?:the|our|my) (?:chats?|messages|texts) (?:after|so (?:my|no one|nobody)|every)\b/);
add("grooming", 0.9, "older_contact", /\b(?:older|grown|adult|\d\d ?(?:yo|y o|year old)|(?:2|3|4|5)\d) (?:man|guy|bloke|boy|lad|woman|girl|person|friend|player|gamer|bf|boyfriend|girlfriend|mate)? ?(?:i met |i know |from |on )?(?:online|on (?:snap|snapchat|insta|instagram|discord|tiktok|roblox|fortnite|xbox|playstation|whatsapp|telegram|kik|omegle|a game|the internet|minecraft|twitch|vr ?chat)|in (?:a|the) (?:game|chat|server|lobby))\b(?= .*(?:wants?|asked|asking|keeps?|says?|said|sent|sends?|buys?|bought|gave|gives?|meet|loves?|secret|pics|call|private|alone|address|live|school))/);
add("grooming", 0.9, "age_gap", /\b(?:he|she|they) (?:is|are|s|says (?:he|she) is|said (?:he|she) (?:is|was)|told me (?:he|she) (?:is|was)) (?:like |about |around |nearly |almost |over )?(?:1[89]|[2-6]\d)\b(?! (?:minutes|mins|seconds|secs|hours|days|weeks|months|percent|points|times|pounds|quid|miles|km|th|st|nd|rd))(?=.*\b(?:i am|im) (?:only )?1[0-7]\b|.*\b(?:boyfriend|girlfriend|dating|going out|loves? me|meet|secret|pics|kiss|sleep|relationship|mature|special)\b)|\bi am (?:only )?1[0-7] (?:and|but) (?:he|she) (?:is|s) (?:like |about |nearly |almost |over )?(?:1[89]|[2-6]\d)\b|\bmy (?:boyfriend|girlfriend|bf|gf|partner) is (?:like |about |nearly |almost |over )?(?:1[89]|[2-6]\d)\b|\b(?:dating|going out with|seeing|in love with|talking to|texting) (?:a|an|this|some) (?:older )?(?:(?:1[89]|[2-6]\d) ?(?:yo|y o|year old)|adult|grown man|grown woman|man|older (?:man|guy|boy|lad|woman|girl))\b/);
add("grooming", 0.85, "mature", /\b(?:says?|said|tells? me|told me|keeps? saying|thinks) i am (?:so |really |very )?(?:mature for my age|not like other (?:girls|boys|kids)|special|his (?:favourite|girl|princess)|different from other (?:girls|boys|kids)|grown up for my age|older than i (?:look|am))\b(?=.*(?:he|she|older|online|secret|meet|pics|gifts?|love))|\bmature for (?:my|your) age\b/);
add("grooming", 0.9, "meet_stranger", /\b(?:wants?|wanted|asked|asking|keeps? asking|told|begging|pressuring) (?:me )?to (?:meet|meet up|come (?:over|round|to (?:his|her|their))|go (?:to|round) (?:his|her|their)|get in (?:his|her|their) car|come alone|sneak out|stay (?:over|at (?:his|hers|theirs)))\b(?=.*(?:online|never met|not met|met (?:him|her|them) on|from (?:snap|snapchat|insta|instagram|discord|tiktok|roblox|fortnite|a game|the internet|omegle)|alone|secret|do not tell|without (?:telling|my (?:mum|dad|parents))|older|stranger|hotel|his (?:flat|house|car)))|\b(?:meet|meeting) (?:up with )?(?:someone|a (?:man|guy|boy|girl|person|friend|lad)|him|her|them) (?:i|that i|who i) (?:met|know|only know|have only (?:spoken|talked) to) (?:online|on (?:snap|snapchat|insta|instagram|discord|tiktok|roblox|fortnite|a game|the internet|omegle|whatsapp))\b|\bgoing to meet (?:him|her|them) (?:alone|in secret|without telling|and (?:my (?:mum|dad|parents) (?:do not|dont)|no one|nobody) knows?)\b/);
add("grooming", 0.85, "gifts", /\b(?:sends?|sent|sending|buys?|bought|buying|gives?|gave|giving|offers?|offered|offering|pays?|paid|paying|promised) (?:me )?(?:gifts?|presents?|money|cash|vbucks|v bucks|robux|skins?|gift cards?|a phone|vapes?|alcohol|weed|credit|nitro|\d+ ?(?:pounds|quid))\b(?=.*(?:if i|for (?:pics|nudes|photos|videos?|a kiss|being his|being her|keeping|meeting|sending)|in return|but i have to|secret|do not tell|older|online|and now (?:he|she|they) (?:wants?|says?)))|\b(?:sugar ?daddy|sugar ?mummy|sugar baby)\b|\bpay(?:s|ing)? me (?:for|to send) (?:pics|nudes|videos?|photos)\b/);
add("grooming", 0.8, "move_private", /\b(?:asked|wants?|told|said|keeps? asking|begged) (?:me )?(?:to )?(?:move|go|switch|chat|talk|add (?:him|her|them)|message (?:him|her|them)|video call|facetime|call) (?:to|on|in|over)? ?(?:snap|snapchat|whatsapp|telegram|kik|discord dms?|private (?:chat|dms?|messages?)|dms?|a private (?:server|chat|call)|somewhere private|video call|facetime) ?(?:instead|alone|in private|where no one|so (?:no one|nobody|my (?:mum|dad|parents)))\b|\bwants? (?:me )?to (?:video call|facetime|call) (?:him |her |them )?(?:alone|in my (?:room|bedroom)|at night|when (?:my (?:mum|dad|parents)|no one|every ?one) (?:is|are) (?:out|asleep|not (?:home|in|around)))\b/);
add("grooming", 0.85, "asks_pics", /\b(?:asked|asking|asks|wants?|wanted|keeps? asking|keeps? on asking|begging|pressuring|told|dared|pushing|pestering) (?:me )?(?:for|to send|to take|to show|to share)(?: (?:him|her|them))? (?:more |some |a |my |private |sexy |naked |nude |body |bikini |underwear |bra |shirtless |cute |special )*(?:pics|nudes|videos?|selfies?|my body|me (?:naked|undressed|in (?:my )?(?:underwear|bra|bikini|pants))|what i (?:am wearing|look like (?:naked|undressed|without)))\b(?! of (?:my|the|our) (?:project|app|code|work|screen|homework|dog|cat|pet|design|drawing|game))/);
add("grooming", 0.8, "love_bomb", /\b(?:he|she|they) (?:says?|said|keeps? saying|tells? me|told me) (?:he|she|they) (?:loves?|loved|is in love with|wants to marry|needs?) me\b(?=.*(?:online|never met|not met|older|\b(?:1[89]|[2-6]\d)\b|secret|pics|do not tell|only (?:one|person) who understands))|\b(?:only (?:one|person) who (?:understands|gets|cares about|loves) me|no one else (?:understands|cares|loves me) (?:like|except) (?:him|her|them))\b(?=.*(?:online|older|secret|met on|discord|snap|insta))/);
add("grooming", 0.85, "asks_location", /\b(?:asked|asking|asks|wants? to know|keeps? asking|wanted to know) (?:me )?(?:where i live|for my address|my address|what school i go to|which school|where i go to school|if i am (?:home )?alone|if my parents are (?:home|in|out)|when my parents are (?:out|away|at work)|what i am wearing|how old i (?:am|was)|for my (?:number|snap|insta))\b(?=.*(?:online|stranger|man|guy|older|discord|snap|insta|game|roblox|fortnite|do not know (?:him|her|them)|never met|creepy|weird|scared|uncomfortable|random))/);

// ── Exploitation (crisis) ───────────────────────────────────────────────────
add("exploitation", 0.95, "sextortion", /\b(?:threaten(?:ing|ed|s)?|going to|says? (?:he|she|they) (?:will|would|ll)|said (?:he|she|they) (?:will|would|d|ll)|will|gonna|might|wants to) (?:to )?(?:share|post|leak|send|show|spread|expose|upload|forward|put) (?:out |around |every ?one |all )?(?:my |the |those |them |it |these )?(?:nudes|pics|videos?|photos|screenshots?|chats?|messages|secrets?)? ?(?:of me |to (?:every ?one|my (?:mum|dad|parents|school|friends|family|followers|class))|online|on (?:insta|instagram|snap|snapchat|tiktok|the internet|social media|the group chat)|around (?:school|my year)|unless|if i (?:do not|dont|did not|stop|tell|block)|everywhere)\b|\b(?:blackmail(?:ing|ed|s)?|sextort(?:ion|ing|ed)?|extort(?:ing|ed|ion)?|revenge porn)\b(?! (?:in|is a|plot|storyline|character|scene) )|\b(?:unless|if i do not|or else) (?:i )?(?:send|pay|give|do) (?:more|him|her|them|money|what)\b(?=.*(?:pics|nudes|leak|post|share|everyone|parents|school))|\b(?:leaked|leaking|leak|shared|sharing|posted|posting|spread|spreading|sent round|screenshotted|screenshot) (?:my |the )?(?:nudes|naked (?:pics|videos?)|private (?:pics|videos?)|pics of me (?:naked|undressed|in my underwear)|intimate (?:pics|videos?))\b|\b(?:my|the) nudes (?:got|have been|were|are|are being) (?:leaked|shared|sent|posted|spread|shown|out|going around)\b/);
add("exploitation", 0.9, "sent_nudes", /\b(?:i )?(?:sent|send|sending|took|have sent|gave|shared|posted|been sending) (?:him|her|them|someone|a (?:man|guy|boy|girl|stranger)|my (?:boyfriend|girlfriend|ex|crush)|this (?:guy|man|boy|girl|person))? ?(?:a |some |my |more |the )?(?:nudes?|naked (?:pics|videos?|selfies?)|nude (?:pics|videos?|selfies?)|pics of (?:me|my body|myself) (?:naked|undressed|topless|in my (?:underwear|bra|pants))|topless (?:pics|selfies?)|explicit (?:pics|videos?)|dirty (?:pics|videos?)|pics of my (?:boobs|chest|bum|private parts|body))\b|\b(?:made|makes?|making|forc(?:ed|es|ing)|pressur(?:ed|es|ing)|guilt(?:ed|s)?|trick(?:ed|s)|persuad(?:ed|es)|convinc(?:ed|es)|manipulat(?:ed|es)) me (?:to |in ?to )?(?:send(?:ing)?|tak(?:e|ing)|shar(?:e|ing)|post(?:ing)?|do(?:ing)?|strip(?:ping)?|undress(?:ing)?|show(?:ing)?|go(?:ing)? on (?:cam|camera|video)|flash(?:ing)?)\b(?=.*(?:nudes?|naked|pics|video|cam|camera|body|clothes|underwear|topless|strip|undress|stuff i did not want))|\b(?:send|sends|sending|sent) (?:me )?(?:nudes|noods)\b(?=.*(?:or|unless|keeps?|will not stop|pressur|said|says|wants|asked|told|boyfriend|girlfriend|he|she|they))|\bwants? (?:me )?to send (?:him |her |them )?(?:nudes|naked pics|pics of my body)\b|\b(?:wants?|asked|asking|told|pressuring|forcing|begging) (?:me )?(?:to )?(?:have sex|do stuff|do things|sleep with (?:him|her|them)|go further|go all the way|lose my virginity)\b(?=.*(?:not ready|do not want|dont want|scared|pressur|force|older|\b(?:1[89]|[2-6]\d)\b|said no|keeps?|or (?:he|she) will|break up|i am 1[0-7]))/);
add("exploitation", 0.9, "criminal", /\b(?:county lines|trap ?house|going (?:country|cunch|ot)|running (?:drugs|a line|lines|country)|run(?:ning)? (?:drugs|packages|food|weed|coke) for|hold(?:ing)? (?:drugs|a (?:knife|gun|strap|weapon)|weapons|money|a package|packages|food|stuff) for (?:him|them|an older|my (?:mates?|friends?) (?:older )?brother|the olders?|a gang|some (?:man|guy|lads))|carry(?:ing)? (?:drugs|packages|a package|stuff) for (?:him|them|an older|the olders?|a gang|some)|made me (?:sell|deliver|carry|hold|hide|move|stash) (?:drugs|weed|coke|packages|a package|stuff|a knife|money)|makes? me (?:sell|deliver|carry|hold|hide|move|stash) (?:drugs|weed|coke|packages|a package|stuff|a knife|money)|(?:the )?olders? (?:make|made|want|told|are making|forced?) me|owe (?:him|them|the olders?|a dealer|my dealer|a gang|these (?:guys|men|lads)) (?:money|\d+|a debt|loads)|in debt to (?:a dealer|my dealer|a gang|the olders?|him|them)|debt bondage|work(?:ing)? off (?:a|my|the) debt|plugging|forced to (?:steal|shoplift|sell|deal|rob|carry|beg|work)|makes? me (?:steal|shoplift|rob|beg)|made me (?:steal|shoplift|rob|beg)|will not let me leave (?:the gang|them|him)|can not leave the gang|gang (?:wants|said|told|is making|made|will (?:hurt|kill|stab)|are after) me|(?:being|been|was|am) trafficked|took my (?:passport|phone|money) (?:so|and) (?:i|now)|makes? me work (?:for (?:no|nothing|free)|all (?:day|night)|and takes)|keeps? (?:all )?my (?:money|wages)|(?:money|cash) mule|use my bank account (?:for|to))\b/);
add("exploitation", 0.85, "sold", /\b(?:sell(?:s|ing)?|sold) (?:me|my (?:body|pics|nudes|videos))\b(?! (?:on|at|a|an|the|my|some) )|\b(?:passed|pass) me (?:around|round) (?:to|his|her|their)\b|\b(?:makes?|made|forc(?:es|ed)) me (?:sleep with|have sex with|go with|do (?:stuff|things) with) (?:his|her|their|other) (?:friends|mates|men|people|guys)\b|\bsex for (?:money|drugs|vapes|a place to stay|food|lifts)\b/);

// ── Immediate danger (crisis, critical) ─────────────────────────────────────
add("immediate_danger", 0.97, "threat_now", /\b(?:he|she|they|someone|somebody|a (?:man|guy|person|stranger)|my (?:dad|stepdad|mum|brother|ex|boyfriend|girlfriend|uncle)|(?:some|these|those) (?:men|guys|lads|people)) (?:is|are|s|has|have|was|were|keeps?|just) ?(?:got |holding |pulled |carrying |waving |coming at me with |threatening me with |pointing )?(?:a |the |his |her |out a )?(?:knife|gun|blade|machete|weapon|bat|hammer|zombie knife|shank|strap)\b(?! (?:in|on|for) (?:the|my|a|his|her) (?:game|kitchen|drawer|collection|costume|shed|toolbox|story|project))|\b(?:going to|is going to|are going to|will|ll|wants to|said (?:he|she|they) (?:will|would|d|ll)|says (?:he|she|they) (?:will|would|ll)|threatened to|threatening to|trying to|tried to) (?:actually |really |literally )?(?:kill|murder|stab|shoot|hurt|strangle|rape|attack|batter|shank|beat) (?:me|us|my (?:mum|sister|brother|family|dog|cat))\b(?=.*(?:tonight|now|right now|outside|here|coming|scared|terrified|afraid|help|knife|gun|serious|means it|not joking|for real|really|actually|police|hiding|locked|please|door|house|done it before|again|when (?:he|she) gets (?:home|back)))/);
add("immediate_danger", 0.35, "kill_me_idiom", /\b(?:my )?(?:mum|dad|parents|teacher|sister|brother|coach|friend|mate) (?:is|are|will|would|s|ll|d) (?:going to |literally |actually |so )*kill me\b/);
add("immediate_danger", 0.95, "intruder", /\b(?:he|she|they|someone|somebody|a (?:man|guy|stranger)|my (?:ex|dad|stepdad)) (?:is|are|s) (?:right )?(?:outside|out side|at) (?:my |the |our )?(?:house|door|window|front door|room|bedroom|flat|home|garden|school gates?)\b(?=.*(?:scared|terrified|afraid|help|will not (?:leave|go)|banging|shouting|trying to get in|knife|gun|hurt|kill|hiding|police|what do i do|not safe|please|again|drunk))|\b(?:someone|somebody|he|they|a (?:man|guy|stranger)) (?:is|are|s) (?:breaking|broke|trying to (?:break|get)|getting|forcing (?:his|their) way) in(?:to)?\b(?! (?:to|my) (?:(?:my )?account|my (?:insta|snap|roblox|minecraft|fortnite)|the (?:app|site|game|server)))|\b(?:i am|we are) (?:being )?(?:followed|chased|stalked|watched|kidnapped|held|trapped|locked in|kept (?:here|in))\b(?=.*(?:right now|now|scared|help|man|guy|car|van|home|street|will not let me|can not (?:get out|leave)|please|someone|he|they|outside))|\b(?:following|chasing|stalking|grabbed|grabbing|cornered) me\b(?=.*(?:right now|now|scared|help|man|guy|car|van|home|street|alone|dark|please|run|hide))|\b(?:i am|im|we are) (?:hiding|locked) in (?:the|my|a) (?:bathroom|toilet|room|bedroom|cupboard|wardrobe|closet|shed|attic)\b(?=.*(?:from|because|scared|he|she|they|dad|mum|help|shouting|drunk|angry|will not stop|please))/);
add("immediate_danger", 0.97, "now_self", /\b(?:i am|im|i will be|i have) (?:standing |sat |sitting |stood |up |already |going to be )*(?:on|at|by|near) (?:the|a|my) (?:edge|bridge|roof|rooftop|ledge|tracks|train tracks|railway|cliff|motorway bridge|top of (?:the|a) (?:car park|building|multi ?storey))\b(?=.*(?:jump|end|goodbye|last|can not|do it|ready|sorry|no one|nobody|done|finally|about to|going to|bye|scared|help|anymore|any more|think i can|want to|tired|enough)|$)|\b(?:about to|going to|gonna) (?:do it|jump|end it|kill myself|take (?:them|the pills|all (?:of )?(?:them|the pills))|swallow (?:them|the pills))\b(?= (?:now|right now|tonight|in a (?:minute|sec|bit)|any (?:minute|second)|i (?:am )?(?:sorry|can not)|goodbye|bye)|$)|\b(?:i (?:have )?(?:just |already )?(?:took|taken|swallowed|necked|cut too deep|cut (?:really |too |so )?deep|done it|did it|drank bleach|drunk bleach)|bleeding (?:a lot|so much|loads|badly|everywhere|and it will not stop|really badly|out)|(?:will not|wont|can not|cant) stop (?:the )?bleeding|can not (?:breathe|wake (?:him|her|them) up|feel my)|(?:he|she|they|my (?:mum|dad|friend|mate|sister|brother)) (?:is|are|s) not (?:breathing|waking up|moving|responding)|(?:passed|passing) out|unconscious|having a seizure|collapsed)\b(?=.*(?:pills|tablets|paracetamol|blood|help|what do i do|scared|dying|die|overdose|too many|sorry|goodbye|please|ambulance|now)|$)|\bi have (?:the|a|my) (?:pills|tablets|rope|blade|razor|knife|gun) (?:ready|here|in my hand|in front of me|next to me|out)\b|\b(?:tonight is|today is|this is) (?:the|my last) (?:night|day)\b(?=.*(?:end|die|goodbye|last|kill|do it|gone)|$)/);
add("immediate_danger", 0.95, "harm_others", /\bi (?:am going to|will|ll|want to|am gonna|am about to|might|swear i will|am planning to|plan to|have a plan to|could|feel like i (?:will|could|might)|am ready to|need to|(?:have|ve) got to) (?:actually |really |literally |just )*(?:kill|murder|stab|shoot|shank|shiv|strangle|poison|bomb|burn down|blow up|shoot up|attack|rape|hurt (?:someone|some people|people|him|her|them|every ?one)|end (?:him|her|them)|slit (?:his|her|their) throat) ?(?:him|her|them|my (?:dad|stepdad|mum|stepmum|brother|sister|teacher|ex|boyfriend|girlfriend|family|class|bully|bullies)|someone|somebody|every ?one|every ?body|people|the (?:school|teacher|class|kid|boy|girl|lad)|this (?:kid|boy|girl|lad|guy|teacher)|that (?:kid|boy|girl|lad|guy|teacher)|a (?:kid|teacher|boy|girl|lad|guy|man|woman)|(?:the|my|our) school|kids at (?:my )?school|(?:whoever|anyone who))\b(?! (?:in|on|at) (?:the game|fortnite|minecraft|roblox|cod|call of duty|gta|fifa|among us|valorant|smash|chess|mario kart|the quiz|my game))|\b(?:bring(?:ing)?|take|taking|took|brought|got|have|carry(?:ing)?|hid(?:e|ing|den)?) (?:a |my |the |dads |my dads )?(?:knife|gun|blade|machete|weapon|zombie knife|shank|strap|bb gun) (?:to|in(?:to)?|at|for) (?:school|college|class|my bag for school|the park to|town to)\b|\bschool shoot(?:ing|er)\b(?=.*\b(?:i|my|me|we|plan|going|want|tomorrow|next|will)\b)|\b(?:shoot|blow|burn|bomb) (?:up|down) (?:the|my|our) school\b/);
add("immediate_danger", 0.8, "runaway", /\b(?:i am|im|i have|ive|i will|ill|going to|about to|planning to|plan to|want to|thinking (?:of|about)|packed (?:a|my) bags? (?:and|to)|i) (?:just |already |actually |really )*(?:run(?:ning)?|ran) away\b(?! (?:from|with) (?:the|my) (?:enemy|enemies|zombies?|boss|monster|player|sprite|character|ball|problem|responsibilit))|\b(?:i have|ive|i am|im) (?:got )?(?:no ?where|not got anywhere|nowhere safe) to (?:go|sleep|stay|live)(?: tonight)?\b|\b(?:sleeping|slept|sleep|staying|living) (?:outside|rough|on the streets?|in (?:a|the) (?:park|bus stop|car park|stairwell|station|shed|car)|at the (?:station|bus stop))\b(?= (?:tonight|again|last night|since|because|cause|for (?:days|\d+)|and (?:i am|it is)|i (?:am|have))|$)|\b(?:homeless|kicked out and) (?:now|tonight|since|and (?:i|have))\b|\bnot going (?:back )?home (?:ever |tonight )?(?:again|ever|because (?:he|she|they|my))\b|\bcan not go (?:back )?home\b(?= (?:tonight|because|cause|or (?:he|she|they)|he|she|they|my (?:dad|mum|stepdad)|i am scared|it is not safe)|$)/);
add("immediate_danger", 0.9, "not_safe_now", /\b(?:i am|im|we are|i do not feel|i dont feel|i am not feeling|not) (?:really |actually |not )?(?:safe|in danger|unsafe) (?:right now|rn|at the moment|tonight|here|where i am|atm|now)\b(?<!am safe right now)(?<!are safe right now)|\bi am (?:not safe|in danger|unsafe|in trouble and scared|being hurt (?:right )?now)\b|\b(?:please )?(?:help me|someone help|i need help) (?:please )?(?:he|she|they|my (?:dad|stepdad|mum|brother|ex)|someone) (?:is|are|s|will|ll|has|have)\b|\bsomeone is going to (?:hurt|kill|get|find) me\b|\bneed (?:the )?(?:police|an ambulance|999|help right now|somewhere safe (?:tonight|now))\b|\b(?:call(?:ing)?|rang|ring(?:ing)?) (?:the police|999|an ambulance)\b(?=.*(?:scared|dad|mum|he|she|they|hurt|blood|help|me|now))/);

// ── Looser combinations (recall): the same signals with words in between ────
const BODY = "(?:leg|legs|thigh|thighs|knee|knees|bum|bottom|chest|boobs|breasts?|waist|hips|back|neck|stomach|private\\w*|crotch|skirt|shirt|top|trousers|body|hair|face|hand)";
add("abuse_disclosure", 0.9, "loose_hurts_me", new RegExp(`\\b(?:my |the |our |this |a |an |some )?${FAMILY}(?: [a-z]+){0,4} ${HURT_VERB}(?: [a-z]+){0,2} (?:me|us)\\b(?! (?:up|off|back) (?:on|with|about|for) )(?! (?:at|in) (?:fifa|mario kart|chess|fortnite|the game|football|tennis|a race|the quiz|monopoly|pool|cards))(?! (?:from|off|out of) (?:the |a |our )?(?:server|game|call|lobby|chat|group|party|team|discord))`));
add("abuse_disclosure", 0.9, "loose_touch", new RegExp(`\\b${FAMILY}(?: [a-z]+){0,5} (?:touch|touches|touched|touching|grabs?|grabbed|grabbing|strokes?|stroked|stroking|rubs?|rubbed|rubbing|squeez\\w+|kiss\\w*|puts? (?:his|her|their) hands? (?:on|up|down)) (?:me\\b(?! (?:that|how|what|why|to|the|a|an|some|by) )|my ${BODY}\\b|me (?:on|up|under|in) (?:my|the) ${BODY}\\b|(?:up|down|under|inside) my ${BODY}\\b)`));
add("abuse_disclosure", 0.9, "threat_if_tell", /\b(?:kill|hurt|hit|beat|batter|stab|leave|hate|punish|get|find) (?:me|us|my (?:mum|family|sister|brother|dog|cat)) if i (?:ever )?(?:tell|told|say|said|speak|spoke|grass|snitch|report)\w*\b|\bif i (?:ever )?(?:tell|told|said anything to|say anything to|speak to|spoke to|grass|snitch) ?(?:any ?one|any ?body|some ?one|my (?:mum|dad|parents|teacher)|a teacher|the police)?\b[^~]{0,50}\b(?:kill|hurt|hit|beat|batter|stab|in (?:big |so much )?trouble|angry|leave|taken away|go to prison|get me|regret)\b|\b(?:what (?:he|she|they) (?:does|do|did|is doing|are doing|has done|have done) to me)\b/);
add("immediate_danger", 0.9, "said_kill_me", /\b(?:said|says|told me|tells me|threatened|threatens|texted|messaged|swore|promised|keeps? saying) (?:that )?(?:he|she|they|he would|she would|they would|he will|she will|they will|he is going to|she is going to|they are going to|to)(?: would| will| is going to| are going to| wants to)? (?:actually |really |literally |come and |come round and |find me and )?(?:kill|murder|stab|shoot|hurt|strangle|rape|attack|batter|shank|beat|get|find) (?:me|us|my (?:mum|sister|brother|family|dog|cat))\b/);
add("grooming", 0.85, "between_us", /\b(?:told|tells?|telling|said|says|asked|asks|wants|made) (?:me )?(?:to )?(?:keep|leave) (?:it|this|that|things|everything|what (?:happened|we do|he does|she does)) (?:just |strictly )?(?:between (?:us|me and (?:him|her|them)|the two of us)|quiet|to myself|private|hush)\b|\bstays? between (?:us|me and (?:him|her|them))\b(?=.*\b(?:he|she|they|him|her|teacher|coach|man|guy|uncle|older)\b)/);
add("grooming", 0.8, "stranger_contact", /\b(?:this|a|some|an older|an|that|random|one) (?:random |older |weird |creepy |strange |grown )*(?:man|guy|bloke|stranger|person|lad|boy|woman|adult|account|dude|user|player)\b[^~]{0,70}\b(?:(?:says?|saying|said|tells? me|told me) (?:he|she|they) (?:loves?|loved|fancies|fancied|wants?|needs?) me|loves? me|wants? my (?:address|number|location|pics|snap|insta|school)|wants? (?:me )?to (?:meet|come|send|call|facetime|go)|keeps? (?:messaging|texting|calling|dming|following|adding|asking|sending|writing to|contacting|pestering|bothering) me|will not (?:stop|leave me alone)|sent me|asked (?:for my|me (?:for|to|where|how old|if))|knows where i live|found my (?:address|school|account))\b/);
add("exploitation", 0.9, "loose_leak", /\b(?:leak|leaks|leaked|leaking|share|shares|shared|sharing|post|posts|posted|posting|send|sends|sending|show|shows|showing|spread|spreading|upload|uploads|uploading|expose|exposes|exposing|forward|forwarding|release|releasing|put out)\w* (?:out |around |round )?(?:the|my|that|those|these|it|them|a|some)? ?(?:video|videos|vid|vids|pics|nudes|clip|clips|screenshots?|chats?|messages|recording|footage|it|them)\b[^~]{0,60}\b(?:unless|if i (?:do not|dont|did not|stop|block|tell)|or else|until i|so i have to|so i (?:had|have) to)\b|\b(?:unless|if i do not|or (?:he|she|they) will|otherwise (?:he|she|they) will) (?:i )?(?:pay|send|give|do|meet)\w*\b[^~]{0,60}\b(?:leak|share|post|show|spread|upload|expose|forward|release)\w*\b|\b(?:pay|send|give) (?:him|her|them)\b[^~]{0,40}\bor (?:he|she|they) (?:will|would|is going to|are going to) (?:leak|share|post|show|spread|upload|expose|tell|send)\w*\b|\bi owe (?:him|her|them) (?:pics|nudes|videos?|sex|a favour|favours)\b|\b(?:says?|said|saying|told me|tells me) i owe (?:him|her|them)\b(?=.*(?:pics|nudes|videos?|sex|favours?|meet|body))/);
add("immediate_danger", 0.8, "homeless", /\b(?:i )?(?:got|been|was|am|have been|getting) (?:kicked|thrown|chucked|locked) out\b(?! of (?:the |a |my )?(?:game|call|lobby|server|chat|group|party|class|lesson|club|team|account|replit|app|site|discord|meeting))|\b(?:i am|im|i have been|i was|and am|been) (?:sleeping|staying|living|kipping) (?:outside|rough|on the streets?|in (?:a|the|my) (?:park|bus stop|car park|stairwell|station|shed|car|garage|woods|tent)|at the (?:station|bus stop|park))\b/);
add("self_harm", 0.85, "cant_do_life", /\b(?:can not|could not|do not want to|not sure i can|do not think i can|not able to) (?:do|face|handle|cope with|deal with|stand|take|bear|live|keep doing|carry on with|go on with) (?:life|living|being alive|this life|my life|another day|existing|being here)\b|\b(?:sick|tired|done|fed up|had enough) (?:of|with) (?:life|living|being alive|this life|my life|existing|being here)\b|\b(?:hate|hating) (?:life|living)\b(?= (?:so much|anymore|and i|rn|right now)|$)/);
add("self_harm", 0.8, "if_i_was_gone", /\bif i (?:did not exist|was gone|were gone|am gone|died|disappeared|vanished|killed myself|was dead|were dead|just (?:died|disappeared|vanished)|never (?:existed|woke up)|(?:was not|were not|am not) (?:alive|born))\b|\b(?:care|notice|miss|better|happier|sad|matter|cry|easier)\b[^~]{0,60}\bif i (?:was not|were not|am not) (?:here|around|about)\b|\bif i (?:was not|were not|am not) (?:here|around|about)\b[^~]{0,60}\b(?:care|notice|miss me|better|happier|sad|matter|cry|easier)\b|\b(?:when|once|after) i am (?:gone|dead|not (?:here|around))\b|\b(?:would|will|does|do|did) (?:any ?one|any ?body|they|you|people) (?:even |really |actually )?(?:care|notice|miss me|be sad|mind|cry)\b(?=.*\b(?:if i|without me|gone|dead|here)\b)/);
const WONT = "(?:will not|not going to|do not think i will|do not think i am going to|doubt i will|might not|probably will not|not planning to|do not plan to|not sure i will|do not see myself|am not going to)";
add("self_harm", 0.85, "wont_be_alive", new RegExp(`\\b${WONT} (?:be|being|still be|even be|stay|make it) ?(?:alive|living)\\b|\\b${WONT} (?:be|being|still be|even be) (?:here|around|about)\\b(?= (?:much longer|for (?:much |very )?long|anymore|any longer|after tonight|by (?:then|morning|the time)|to see|soon enough)|$)`));
add("self_harm", 0.3, "wont_be_here", new RegExp(`\\b${WONT} (?:be|being|still be|even be) (?:here|around|about)\\b`));
add("self_harm", 0.8, "end_it", /\b(?:i am going to|i will|i want to|i am about to|going to|about to|want to|ready to|time to|might|thinking (?:of|about)|decided to|i just want to|need to|have to|planning to|i am ready to) (?:just |finally |actually )?(?:end it|end things|finish it|finish myself|do it tonight|go through with it)\b(?! (?:early|when|after|there|here|with|on|at|by|before|in|so|if the|once|quicker|faster|sooner|properly))/);
add("self_harm", 0.9, "better_off_gone", /\b(?:every ?(?:one|body)|they|you all|my (?:family|parents|mum|dad|friends|mates)|the world|people|things|it) (?:is|are|would be|will be|would all be|might be|could be)? ?(?:all )?(?:so much |much |a lot |way |just )?(?:better|happier|easier|fine)(?: off)? (?:without me|if i (?:am|was|were) (?:gone|dead|not (?:here|around|alive))|if i (?:just )?(?:died|disappeared|left|vanished|was never born)|when i am gone|once i am gone|with me gone)\b/);
add("self_harm", 0.95, "method_loose", /\bi (?:keep |always |just |often |sometimes |still |cant stop |can not stop )*(?:think|thinking|thought|dream|dreaming|imagine|imagining|fantasi[sz]e|fantasi[sz]ing|feel like|want|wanted|plan|planning|picture|picturing)(?: (?:about|of|to))? (?:jumping|jump|walking|stepping|throwing myself|driving|crashing|hanging|drowning|overdosing|taking (?:all|too many)|swallowing|slitting|cutting (?:deep|too deep|my wrists?)|shooting myself|stabbing myself|not waking up|dying|being dead|my (?:own )?(?:death|funeral)|how i would do it|ways to (?:die|do it|end it))\b/);
add("self_harm", 0.9, "burn_self", /\b(?:burn|burns|burning|burnt|burned|cut|cuts|cutting|scratch|scratches|scratching|hit|hits|hitting|hurt|hurts|hurting|punch|punches|punching|bite|bites|biting|pinch|pinches|pinching|harm|harms|harming|bang|bangs|banging) (?:my ?self|me self)\b|\bself harm\w*\b|\b(?:sh|self harm|cutting|suicidal|suicide|intrusive|dark|bad) (?:urges?|thoughts)\b(?=.*\b(?:bad|tonight|again|strong|back|really|so|can not|getting|every|keep|lately|rn|right now|i)\b)|\b(?:i )?(?:overdosed|od ?ed|tried to (?:kill myself|end (?:it|my life)|overdose|hang myself|commit)|attempted(?: suicide)?|attempt(?:ed)? (?:it|again)|survived (?:an|my) attempt)\b/);

add("self_harm", 0.9, "happier_dead", /\b(?:i would|i will|i might|i could|i am|i think i am|i think i would) (?:just |probably |honestly )?(?:be )?(?:so much |much |a lot |way )?(?:happier|better off|better|calmer|at peace|safer) (?:dead|gone|not (?:here|alive|existing|being here)|if i (?:was|were) (?:dead|gone))\b|\b(?:go to sleep|fall asleep|sleep|close my eyes) and (?:just )?(?:not|never) wake up\b|\btonight is the night\b[^~]{0,40}\b(?:sorry|goodbye|bye|forgive|love you)\b|\b(?:sorry|goodbye|bye|forgive me)\b[^~]{0,40}\btonight is the night\b/);
add("self_harm", 0.6, "no_way_out", /\b(?:no|not any|can not see (?:a|any)|there is no|do not see (?:a|any)|is there (?:a|any)) (?:other )?way out\b(?! of (?:the |this |my |a )?(?:loop|function|menu|screen|level|maze|room|page|bug|error|step|game|app|settings|fullscreen|full screen))|\b(?:trapped|stuck) (?:in my (?:life|head|own head)|and (?:there is|theres) no (?:escape|way))\b/);
add("abuse_disclosure", 0.85, "told_to_die", /\b(?:told|tell|tells|telling|said|say|says|saying|texted|messaged|commented|posted|wrote)\b[^~]{0,30}\b(?:me|i should|i need|i ought|i might as well)(?: to)? (?:go (?:and )?die|kill myself|kms|kys|die|end (?:it|my life)|off myself|neck myself|hang myself|drink bleach|jump off|do every ?one a favour)\b/);
add("abuse_disclosure", 0.85, "feel_sick", new RegExp(`\\b(?:makes?|made|making) me feel (?:so |really |a bit |kind of )?(?:sick|dirty|disgusting|scared|uncomfortable|gross|weird|horrible|ashamed|unsafe|creeped out)\\b(?=.*\\b(?:what (?:he|she|they) (?:does|do|did)|when (?:he|she|they)|stay behind|alone with|on (?:his|her) (?:lap|knee)|touch|looks? at me|watch)\\b)|\\bsit(?:s|ting)? on (?:his|her|their) (?:lap|knee)\\b|\\bis it (?:normal|ok|okay|allowed|weird|bad|wrong) (?:for|if|when|that) (?:my|your|a|an|someones?) ${FAMILY}(?: [a-z]+){0,3} (?:to )?(?:touch|ask|sit|come|watch|kiss|sleep|bath|shower|look|hit|lock|check|take pics)\\w*\\b`));
add("abuse_disclosure", 0.9, "gives_bruises", new RegExp(`\\b${FAMILY}(?: [a-z]+){0,4} (?:gives?|gave|leaves?|left|giving|leaving) (?:me|us) (?:bruises?|marks?|a black eye|black eyes|cuts?|burns?|scars?|welts?)\\b|\\b(?:me|us) with (?:his|her|their|a|the) (?:belt|fists?|stick|cane|shoe|slipper|cable|wire|iron|hairbrush|wooden spoon)\\b|\\bwith (?:his|her|their) (?:belt|fists?|cane|slipper)\\b(?=.*\\b(?:me|my)\\b)`));
add("grooming", 0.8, "and_not_tell", new RegExp(`\\b(?:and|to|but|so) (?:i (?:must|should|can) )?(?:not|never) (?:to )?tell\\b(?=$| (?:any ?one|any ?body|my (?:mum|dad|parents|family|teacher)|people|a soul| ?\\.))(?<=\\b${FAMILY}\\b.*)`));
add("grooming", 0.8, "waits_for_me", /\b(?:this|a|some|an older|an|that|random|one|the same) (?:random |older |weird |creepy |strange |grown )*(?:man|guy|bloke|stranger|person|woman|adult|car|van)\b[^~]{0,40}\b(?:waits?|waiting|waited|follows?|following|followed|watch(?:es|ing|ed)?|stares? at|staring at|hangs? around|hanging around|turns? up|turned up|shows? up|showed up|parks?|parked|drives? past|takes? pics of) (?:for |at |outside |near |by |up at |me|us|my)\b/);
add("exploitation", 0.9, "underwear_pics", /\b(?:sent|send|sending|took|shared|posted|gave|snapped|showed)\b[^~]{0,30}\bpics\b[^~]{0,30}\b(?:in my (?:bra|underwear|pants|bikini|boxers|knickers|towel)|naked|topless|without (?:my|a) (?:top|shirt|clothes)|of my body|undressed)\b|\b(?:showing|sharing|sending|posting|passing) (?:it|them|my pics|the pics|the video) (?:to |around |round )?(?:people|every ?one|his (?:mates|friends)|her (?:mates|friends)|the (?:whole )?(?:school|year|class))\b(?=.*\b(?:pics|video|bra|underwear|naked|nudes|body)\b)/);
add("exploitation", 0.85, "package", /\b(?:package|packages|parcel|parcels|bag|bags|box|stuff)\b[^~]{0,30}\b(?:deliver|drop off|carry|hold|hide|look after|stash|move|take)\w*\b[^~]{0,40}\b(?:older|olders|gang|men|lads|for (?:him|them)|scared|do not know what|said not to)\b|\b(?:older|olders|gang|some (?:men|lads|guys))\b[^~]{0,40}\b(?:package|packages|parcel|bag|box)\b[^~]{0,30}\b(?:deliver|drop off|carry|hold|hide|look after|stash|move|take)\w*\b/);

// ── Sexual content ───────────────────────────────────────────────────────────
add("sexual_minors", 1, "explicit", /\b(?:child ?porn\w*|kiddie ?porn|csam|csem|cp (?:links?|pics|videos?|server|trade|trading)|pedo ?(?:porn|pics|stuff|content)|paedo ?(?:porn|pics|stuff|content)|jail ?bait|underage (?:porn|nudes|sex|pics|girls? naked|boys? naked)|loli ?(?:porn|hentai|nsfw|sex)|shota ?(?:porn|hentai|nsfw|sex)|sexuali[sz](?:e|ing|ed) (?:a |the )?(?:child|children|kids?|minors?)|sex with (?:a |an )?(?:child|kid|minor|underage|little (?:girl|boy)|\d{1,2} ?(?:yo|y o|year old))|naked (?:child|children|kids?|minors?|little (?:girls?|boys?)))\b/);
add("sexual_minors", 0.95, "sexual_plus_minor", new RegExp(`\\b${SEXUAL_EXPLICIT}\\b[^~]{0,80}\\b${MINOR}\\b|\\b${MINOR}\\b[^~]{0,80}\\b${SEXUAL_EXPLICIT}\\b`));
add("sexual", 0.95, "explicit_request", /\b(?:write|make|generate|give|show|tell|send|describe|draw|create|find|link|do)(?: me| us)? (?:a |an |some |the |any |me )*(?:sex(?:ual|y)? (?:scene|story|stories|chat|roleplay|role play|fan ?fic|fantasy|content|pics|images|video)|erotic\w*|erotica|smut|porn\w*|nsfw|lewd (?:story|pic|image|content)|nudes?|naked (?:pics|image|girl|boy|woman|man|people)|hentai|rule ?34|dirty (?:story|talk|chat|pics)|steamy (?:scene|story)|spicy (?:scene|story|fan ?fic))\b|\b(?:sext(?:ing)?|talk dirty|dirty talk|cyber ?sex|phone sex)\b(?! (?:is|are|means|safety|awareness|risks?|laws?))/);
add("sexual", 0.9, "explicit_terms", /\b(?:porn|porno|pornography|pornhub|xvideos|xhamster|only ?fans|hentai|rule ?34|blow ?jobs?|hand ?jobs?|masturbat\w*|wank(?:ing|ed)?|jerk(?:ing)? off|orgasm\w*|cumming|cum ?shot|deep ?throat|threesome|gang ?bang|anal sex|oral sex|bdsm|bondage|fetish\w*|kinky|dildo|vibrator|sex toys?|sex positions?|doggy style|69ing|creampie|milf|dilf|horny|nsfw)\b/);
add("sexual", 0.7, "sex_talk", /\b(?:how (?:do|to|can) (?:i|you|we|people|u) (?:have|do) sex|have sex with|having sex with|had sex with|want(?:s)? (?:to have )?sex|lose my virginity|losing my virginity|is (?:it|sex) (?:ok|okay|normal|legal) to have sex|sexy (?:pics|girl|boy|outfit|pose|voice|chat|ai|character)|make (?:her|him|it|the character|the ai friend|my ai friend) (?:sexy|hot|flirty|naked|strip)|naked|nudes?|nudity|boobs?|tits|titties|dick pics?|penis|vagina|strip(?:per|pers|ping)?|turn(?:s|ed)? me on|aroused|seduc\w+)\b/);
add("sexual", 0.8, "romance_roleplay", /\b(?:be|act as|pretend (?:to be|you are|you re)|you are(?: now)?|can you be|will you be|play|roleplay as|role play as|talk like|act like)(?: my| a| an| me a)? ?(?:ai |virtual |secret |new |real |loving |flirty |hot |sexy )*(?:girlfriend|boyfriend|gf|bf|lover|wife|husband|crush|waifu|husbando|sugar ?daddy|date|soulmate|bae)\b|\b(?:flirt with me|date me|go out with me|kiss me|make out with me|cuddle (?:with )?me|marry me|be mine|seduce me|do you (?:love|fancy|like like) me|say you love me|tell me you love me|i love you (?:so much )?(?:coach|baby|babe)|love you babe|are you single|will you be my valentine|call me (?:babe|baby|daddy|mommy|mummy|sexy|your (?:girlfriend|boyfriend)))\b/);
add("sexual", 0.5, "romance_mild", /\b(?:kissing scene|make out scene|making out|snogging|love scene|sexy|hot (?:girls?|boys?|guys?|women|men)|thirst trap|rizz (?:up|her|him) (?:with|by) (?:nudes|pics)|fit (?:girls?|boys?|lads?) (?:pics|naked))\b/);

// ── Violence ─────────────────────────────────────────────────────────────────
add("violence", 0.95, "instructions", /\b(?:how (?:do|to|can|could|would|should) (?:i|you|we|u|someone|one)?|best way to|easiest way to|ways to|teach me (?:how )?to|show me how to|tell me how to|steps to|guide (?:to|for)|instructions (?:to|for)|tutorial (?:on|for)) ?(?:to )?(?:actually |really |quickly |quietly |secretly )*(?:make|build|create|assemble|3d print|print|get|buy|obtain|hide|sneak|smuggle|sharpen) (?:a |an |my own |some |home ?made |diy |the )*(?:bomb|bombs|explosives?|pipe bomb|molotov|grenade|gun|guns|firearm|ghost gun|weapon|weapons|silencer|napalm|thermite|poison|nerve agent|ricin|chlorine gas|mustard gas|taser|knuckle ?duster|flamethrower|zip gun|shank)\b(?! (?:in|for|on) (?:my |the |a )?(?:game|scratch|roblox|minecraft|unity|godot|app|story|animation|level|sprite))|\b(?:how (?:do|to|can|could|would|should) (?:i|you|we|u|someone|one)?|best way to|easiest way to|ways to|teach me (?:how )?to|show me how to|tell me how to) ?(?:to )?(?:actually |really |quickly |quietly |secretly )*(?:kill|murder|poison|strangle|choke|stab|shoot|hurt|injure|beat up|knock out|torture|kidnap|drug|spike|stalk|get away with (?:murder|killing|hurting)|hide a body|dispose of a body|make (?:someone|him|her|them) (?:disappear|suffer|bleed|pass out)) ?(?:a |an |some |my |the |another )?(?:one|person|people|someone|somebody|human|man|woman|kid|child|him|her|them|teacher|dad|mum|brother|sister|ex|bully|girl|boy|friend|neighbour|dog|cat|animal|pet|drink)\b(?! (?:in|on|at) (?:the |my |a )?(?:game|fortnite|minecraft|roblox|cod|gta|among us|story|scratch|level))/);
add("violence", 0.9, "threat", /\b(?:i (?:will|ll|am going to|want to|wanna|could|would love to|am gonna)|let us|lets|we should|someone should|go) (?:actually |really |literally |just |all )*(?:kill|murder|stab|shoot|shank|strangle|batter|beat (?:up|the (?:crap|shit|hell) out of)|smash (?:up|in)|slit|curb stomp|jump|knock out|punch|slap|kick|hurt|torture|destroy) ?(?:you|u|ya|him|her|them|that (?:kid|boy|girl|lad|guy|teacher)|this (?:kid|boy|girl|lad|guy|teacher)|every ?one|his (?:face|head)|her (?:face|head)|your (?:face|head))\b(?! (?:in|on|at) (?:the |my |a )?(?:game|fortnite|minecraft|roblox|cod|gta|fifa|among us|chess|mario kart|smash|level|quiz|leaderboard))|\b(?:kys|kill your ?self|go (?:and )?die|drop dead|hope you die|i hope (?:you|he|she|they) (?:die|dies|get (?:hit|stabbed|cancer))|neck your ?self|unalive your ?self|rope your ?self)\b/);
add("violence", 0.85, "graphic", /\b(?:gore|gory (?:pics|videos?|images)|snuff|beheading|behead(?:ed|s)?|decapitat\w+|dismember\w*|disembowel\w*|mutilat\w+|torture (?:scene|video|porn|methods?)|animal (?:cruelty|abuse|torture)|kill(?:ing)? (?:a |my |the |some )?(?:cat|dog|kitten|puppy|animals?|pets?) (?:for fun|slowly|and film)|live ?leak|execution videos?|cartel videos?|blood and guts everywhere|rip (?:his|her|their) (?:guts|head|throat) out)\b/);
add("violence", 0.55, "weapons_talk", /\b(?:zombie knife|machete|knuckle ?duster|flick knife|butterfly knife|buy a (?:knife|gun|blade|taser|bb gun)|carry a (?:knife|blade|shank)|carrying a (?:knife|blade|shank)|knife crime tips|where (?:can|do) i (?:get|buy) a (?:knife|gun|blade|weapon)|stab (?:someone|him|her|them)|stabbing (?:someone|him|her|them)|fight (?:him|her|them|someone) after school|jump (?:him|her|them) after school|beat (?:him|her|them) up|how to win a (?:street )?fight|how to (?:throw|land) a punch)\b/);
add("violence", 0.3, "game_violence", /\b(?:kill|shoot|stab|punch|fight|attack|destroy|explode|blood|weapon|gun|sword|bomb)\w*\b/);

// ── Hate ─────────────────────────────────────────────────────────────────────
add("hate", 0.95, "slur", /\b(?:n[i1]gg(?:er|a|ers|as)|nigg+uh|f[a@]gg?(?:ot|ots|y)|fag|fags|tr[a@]nn(?:y|ies)|ret[a@]rd(?:s|ed)?|sp[a@]stic|spaz+|p[a@]ki(?:s)?|ch[i1]nk(?:s|y)?|g[o0]{2}k(?:s)?|k[i1]ke(?:s)?|sp[i1]c(?:s)?|wetback(?:s)?|coon(?:s)?|raghead(?:s)?|towelhead(?:s)?|gyppo(?:s)?|pikey(?:s)?|dyke(?:s)?|shemale(?:s)?|mong(?:s)?|mongoloid|untermensch|subhuman(?:s)?|sand ?n\w+|jungle ?bunn(?:y|ies)|porch ?monkey(?:s)?|beaner(?:s)?|golliwog(?:s)?|wog(?:s)?|darkie(?:s)?|half ?breed(?:s)?|kaffir(?:s)?|yid(?:s)?|poof(?:s|ter|ters)?|lezzer(?:s)?|window ?licker(?:s)?)\b/);
add("hate", 0.9, "group_attack", new RegExp(`\\b(?:i (?:really |just |actually |f\\w+ )?(?:hate|despise|can not stand|cant stand)|all|every|those|these|the|bloody|f\\w+ing|dirty|filthy|stupid) (?:all |the |those |these |dirty |filthy |f\\w+ing |bloody )*${GROUPS} (?:are|is|should|must|need to|deserve|belong|do not deserve|dont deserve|all|can|are all|should all) ?(?:all |just |be |to )*(?:scum|vermin|animals|subhuman|disgusting|filth|filthy|dirty|evil|inferior|stupid|die|be (?:killed|shot|gassed|hanged|deported|banned|wiped out|exterminated|locked up)|go back|not (?:human|welcome|belong)|a disease|a plague|criminals|terrorists|rapists|parasites|trash|rubbish|worthless|the problem|ruining)\\b|\\b(?:i (?:really |just |actually |f\\w+ )?(?:hate|despise)) (?:all |the |those |these )*${GROUPS}\\b|\\b(?:kill|gas|hang|shoot|burn|deport|ban|exterminate|wipe out|get rid of|lynch|bash|beat up) (?:all |the |those |every |these )*${GROUPS}\\b|\\bgo back to (?:your|their|where (?:you|they) came from) ?(?:own )?(?:country)?\\b|\\b${GROUPS} (?:are|r) (?:not|n t) (?:real )?(?:people|human|humans|welcome here)\\b`));
add("hate", 0.9, "symbols", /\b(?:heil hitler|sieg heil|hitler was right|hitler did nothing wrong|white power|white pride world ?wide|white suprem\w+|master race|14 ?88|1488|gas the|race traitor|ethnic cleansing|holocaust (?:was (?:a )?(?:fake|hoax|lie)|never happened|did not happen|denial)|kkk|ku klux|great replacement|white genocide|blood and soil|rahowa|make (?:me )?a (?:racist|sexist|homophobic|transphobic|antisemitic) (?:joke|meme|song|rap|poem|story))\b/);
add("hate", 0.55, "insult_identity", /\b(?:thats? so gay|that is so gay|so gay|you are gay|ur gay|no homo|(?:act|acting|sound|sounds|looks?) (?:so )?(?:gay|autistic|retarded|special needs)|are you (?:autistic|special needs|disabled|slow|dumb) or (?:something|what)|(?:girls|women|females) (?:can not|cant|should not|shouldnt|are (?:too|so) (?:dumb|stupid|weak|emotional) to) (?:code|program|game|do (?:maths|tech|science)|drive|lead)|(?:make|go make) me a sandwich|(?:women|girls) belong in the kitchen|(?:fat|ugly|poor|ginger) (?:people|kids|girls|boys) (?:are|should|deserve))\b/);

// ── Drugs and alcohol ───────────────────────────────────────────────────────
add("drugs", 0.95, "acquire", new RegExp(`\\b(?:how (?:do|to|can|could|would) (?:i|you|we|u|someone|kids|teens|a \\d\\d year old)?|where (?:do|to|can|could) (?:i|you|we|u)?|best way to|easiest way to|ways to|help me|teach me (?:how )?to|show me how to|tell me how to|is it easy to|can (?:i|you|u) (?:help me )?) ?(?:to )?(?:actually |secretly |quickly |cheaply )*(?:buy|get|score|order|find|make|cook|grow|roll|take|smoke|snort|sniff|inject|shoot up|vape|sell|deal|hide|sneak|smuggle|pass a drug test (?:for|after)|get served|get hold of|get away with (?:taking|smoking|drinking|selling)) (?:a |an |some |my |the |any |more |cheap |strong |my own )*${DRUG}\\b(?! (?:and alkali|rain|reaction))`));
add("drugs", 0.9, "use_hard", new RegExp(`\\b(?:i (?:am|was|got|get|have been|keep|want to (?:get|be|try)|wanna (?:get|be|try)|tried|took|take|did|do|smoked|smoke|snorted|sniffed|dropped|popped|sold|sell|am selling|deal)|we (?:got|get|took|did|smoked|were)|lets get|let us get|getting|got|get|been) (?:so |really |proper |absolutely |a bit |some |a |an )*(?:high|stoned|baked|wasted|off my (?:head|face)|buzzing off|fried|zooted|tripping|on a (?:trip|comedown)|coming up|rolling|${HARD_DRUG})\\b(?! (?:score|scores|quality|level|contrast|five|school|priority|res|resolution|speed))|\\b(?:my |a |the )?(?:dealer|plug|shotter)\\b(?=.*(?:${DRUG}|buy|sell|owe|text|price|gram|bag|ounce|deliver))|\\b(?:a |an |half a |\\d+ )?(?:gram|grams|eighth|q|ounce|oz|bag|baggie|tab|tabs|pills?) of ${HARD_DRUG}\\b|\\b(?:fake id|fake ids|fake i d|get served (?:under ?age|at 1[0-7])|buy (?:alcohol|booze|vapes?|cigarettes|cigs|fags) (?:under ?age|at 1[0-7]|without id|for me))\\b`));
add("drugs", 0.55, "use_mild", /\b(?:get(?:ting)? (?:drunk|hammered|plastered|smashed|wasted|pissed|lit|mortal|steaming)|got (?:drunk|hammered|plastered|smashed|wasted|pissed|mortal)|pre ?drinks|pres before|down(?:ing)? (?:shots|vodka|a bottle)|drinking game|beer pong|hangover cure|sneak(?:ing)? (?:alcohol|booze|vodka|drink) (?:in|out|into)|nicotine (?:rush|buzz|hit)|vape (?:tricks|flavours?|shop|juice|at school|in (?:the )?(?:toilets|school))|best vapes?|hide (?:my|a) vape|hiding (?:my|a) vape|elf ?bars?|how many units|stoner|420|smoke up|sesh|ket ?head|coke ?head|crack ?head|druggie)\b/);
add("drugs", 0.4, "mention", new RegExp(`\\b(?:weed|cannabis|marijuana|cocaine|mdma|ecstasy|ketamine|lsd|shrooms|heroin|meth|xanax|vapes?|vaping|drunk|booze|alcohol)\\b`));

// ── Extremism ────────────────────────────────────────────────────────────────
add("extremism", 0.95, "support", /\b(?:join(?:ing)? (?:isis|isil|daesh|al ?qaeda|the taliban|hamas|hezbollah|the kkk|national action|atomwaffen|the base|a (?:terror(?:ist)?|extremist|neo ?nazi|jihadi(?:st)?) (?:group|cell|org\w*))|how (?:do|to|can) (?:i|you|we)? ?(?:to )?(?:join|contact|support|fund|recruit for|make a) (?:isis|isil|daesh|al ?qaeda|the taliban|a (?:terror(?:ist)?|extremist|militia) (?:group|cell)|terror(?:ist)? (?:attack|cell))|(?:plan|planning|carry out|carrying out|commit|committing|do|doing|stage|staging) (?:a |an |my own |the )?(?:terror(?:ist)? attack|attack on (?:a |the )?(?:mosque|synagogue|church|school|temple|crowd|parliament|concert)|mass shooting|massacre|bombing|martyrdom (?:operation|mission)|suicide bombing|lone wolf attack|vehicle attack)|(?:write|make|draft|help (?:me )?(?:write|with)) (?:me )?(?:a |an |my )?(?:manifesto|recruitment (?:post|video|speech)|propaganda (?:post|video|leaflet|speech|poster))\b(?=.*(?:attack|race|war|jihad|uprising|revolution|kill|purge|infidels?|enemy|traitors?|white|nation))|(?:race|holy) war (?:now|is coming|soon)|(?:start|starting|begin|beginning|need|want|bring on) (?:a |the )?(?:race war|holy war|jihad|boogaloo|day of the rope|civil war against)|(?:kill|death to|behead|slaughter|purge) (?:the |all |every )?(?:infidels?|kuffar|kafirs?|non ?believers|apostates?|traitors|normies|chads|foids|roasties)|(?:day of (?:the rope|retribution)|accelerationis[mt]|siege culture|incel (?:uprising|rebellion|revolution)|going er|supreme gentleman|become a martyr|martyr myself|lone wolf)|(?:praise|respect|salute|support|love|stan|inspired by) (?:the )?(?:christchurch|columbine|9 ?11|manchester arena|buffalo|utoya) (?:shooter|shooters|attack|attacker|bomber|hijackers|gunman)|(?:brenton tarrant|anders breivik|elliot rodger|dylann roof) (?:was (?:right|a hero|a saint)|is (?:a|my) hero|did nothing wrong)|saint (?:tarrant|breivik|roof|rodger))\b/);
add("extremism", 0.55, "interest", /\b(?:isis|isil|daesh|al ?qaeda|jihad|jihadi(?:st)?s?|caliphate|neo ?nazis?|nazis? were right|fascis[mt] is (?:good|right|the answer)|far right (?:group|forum|discord|telegram)|radicali[sz]ed?|extremist (?:group|forum|content|videos?)|terror(?:ist)? (?:group|cell|training|videos?|forum)|incels? (?:forum|are right|were right)|black pill(?:ed)?|red pill(?:ed)? (?:on|about) (?:women|jews|race)|andrew tate (?:is right|was right) about women|great reset conspiracy|zog|globalists? control|jews? (?:control|run|own) (?:the )?(?:world|media|banks))\b/);

// ── Personal-data oversharing ───────────────────────────────────────────────
add("pii_oversharing", 0.7, "placeholders", /(?:\[[a-z ]+ removed\].*){3,}/, "input");
add("pii_oversharing", 0.6, "school", /\b(?:i go to|i am at|i attend|my school is(?: called)?|i am in year \d+ at|student at|pupil at) (?:the )?(?!school\b|a school\b|my school\b|the same\b|a (?:state|private|grammar|boarding|secondary|sixth) )(?:[a-z]+ ){1,4}(?:school|academy|college|high|grammar|sixth form|secondary|comp|comprehensive)\b/, "input");
add("pii_oversharing", 0.6, "home", /\b(?:i live (?:at|on|in (?:a (?:flat|house) (?:at|on)|number))|my (?:home )?address is|my house (?:is|number is) (?:at|on|number)?|my (?:phone |mobile |home )?number is|my (?:mums?|dads?|parents?) (?:phone |mobile )?number is|my (?:mums?|dads?|parents?) (?:bank|card|credit card|debit card|account) (?:details|number|is)|my (?:nhs|national insurance|passport|bank account|sort code) (?:number|no|details)? ?(?:is|are)|my full name is|my real name is|my surname is|my last name is|my (?:date of birth|dob|birthday) is|i was born on)\b(?! (?:name|address|phone number|email|postcode|date of birth|username|number) removed)/, "input");
add("pii_oversharing", 0.55, "alone", /\b(?:i am|im) (?:home|at home|in the house) (?:all )?alone (?:right now|rn|tonight|all (?:day|night|week|weekend)|until|till|every)\b|\bmy (?:parents|mum and dad|mum|dad) (?:are|is) (?:out|away|at work|on holiday|not (?:home|in|back)) (?:all (?:day|night|week|weekend)|until|till|tonight|every (?:day|night)|for the (?:night|week|weekend))\b|\bheres? (?:a |my )?(?:pics|selfie|selfies) of (?:me|my face|myself)\b|\bthis is what i look like\b|\bmy (?:live )?location is\b|\bi will (?:send|share|drop) (?:you )?my (?:location|address|number|snap|insta)\b/, "input");
add("pii_oversharing", 0.9, "asks_personal", /\b(?:what is|whats|tell me|give me|can (?:i|you) (?:have|tell me|share|give me)|send me|share|type|enter|i need|could (?:i|you) (?:have|tell me|share)) (?:your|ur) (?:full |real |first |last |sur|home |exact |current |mobile |phone |email |street )*(?:name|address|postcode|location|school|phone number|number|mobile|email|date of birth|birthday|dob|age and (?:where|school)|password|passcode|pin|login|log in details|one time code|verification code|otp|card (?:number|details)|bank details|api key|secret key|snap|snapchat|insta|instagram|tiktok|discord|username and password|parents? (?:names?|number|email|card))\b|\bwhere (?:do|did) you (?:live|go to school)\b|\b(?:which|what) school do you go to\b|\bhow old are you\b|\bsend (?:me )?(?:a )?(?:pics|selfie) of (?:you|yourself|your face|your room|your house)\b|\b(?:paste|share|send|type|enter|give me) (?:your|the) (?:api key|password|secret key|one time code|verification code|card (?:number|details)|token)\b/, "output");

// ── Academic dishonesty ─────────────────────────────────────────────────────
const SCHOOL_WORK =
  "(?:home ?work|hw|course ?work|essay|essays|assignment|assignments|nea|epq|personal statement|dissertation|controlled assessment|book (?:review|report)|lab report|write ?up|history (?:essay|homework|coursework)|english (?:essay|homework|coursework|lit(?:erature)? (?:essay|homework))|science (?:homework|coursework|write ?up)|maths? (?:homework|coursework|worksheet)|geography (?:essay|homework|coursework|fieldwork)|re (?:essay|homework)|pshe (?:essay|homework)|french (?:homework|essay|speaking)|spanish (?:homework|essay|speaking)|german (?:homework|essay)|business (?:coursework|essay)|computer science (?:nea|coursework|homework)|dt (?:nea|coursework)|art (?:essay|coursework)|pe (?:coursework|essay)|speech for (?:school|english|class|my (?:teacher|class))|presentation for (?:school|class|my (?:teacher|class))|creative writing (?:piece|coursework|for english)|poem for (?:english|school|class|homework)|story for (?:english|school|class|homework)|paragraph for (?:english|history|school|class|homework|my (?:teacher|essay))|pee(?:l)? paragraph|revision notes for me|school (?:project|report|work)|worksheet|past paper|mock (?:exam|paper)|exam (?:question|paper|answer)|gcse (?:coursework|essay|question|paper|nea)|a ?level (?:coursework|essay|question|paper|nea)|btec (?:assignment|coursework|unit)|t ?level (?:assignment|coursework)|uni (?:essay|assignment|application)|ucas (?:statement|personal statement)|college (?:assignment|essay|application essay))";
add("academic_dishonesty", 0.95, "write_my", new RegExp(`\\b(?:write|do|finish|complete|type(?: up)?|make|produce|generate|draft|create|knock out|sort|bang out|answer|solve|fill in|fill out)(?: (?:up|out))?(?: (?:me|us))?(?: (?:all|the rest) of)? (?:my|me my|this|the|an?|our|me an?|his|her|some|all (?:of )?my|tonights|tomorrows|next weeks)(?: (?:whole|entire|full|\\d+ ?(?:word|words|page|pages|paragraph|paragraphs|mark)|[a-z]+ ?(?:word|page)))* ${SCHOOL_WORK}\\b(?! (?:step|checker|planner|tracker|app|timer|reminder|helper|organiser|organizer|quiz app|tool))`));
add("academic_dishonesty", 0.95, "essay_request", /\b(?:write|give|make|generate|produce|draft|do)(?: me| us)? (?:a|an|my|the|me a|me an) (?:\d+ ?(?:word|words|page|pages|paragraph|paragraphs|mark)s? )?(?:whole |entire |full |complete |finished |good |a ?star |grade 9 |top marks? |model )*(?:essay|coursework|personal statement|dissertation|book report|book review|lab report|model answer|\d+ ?marker|\d+ ?mark (?:answer|question|response))\b(?! (?:plan|structure|outline|checklist|planner|about how i|feedback))|\b(?:essay|coursework|homework|assignment|personal statement) (?:for me|on my behalf|so i (?:do not|dont) have to|that i can (?:hand in|submit|copy|use))\b|\bwrite it for me\b(?=.*(?:school|teacher|homework|coursework|essay|hand in|submit|due|class|exam|marks?|grade))/);
add("academic_dishonesty", 0.95, "exam_answers", /\b(?:what (?:is|are|s)|whats|give me|tell me|i need|show me|just give me|can (?:i|you) (?:have|give me|tell me)|send me|leak|find me|got|get me) (?:all )?(?:the |my |me the |some )?(?:answers?|mark ?scheme|solutions?|correct (?:answers?|options?))(?: (?:to|for|of|on))? (?:(?:all|each|every) (?:of )?)?(?:my |the |this |these |tomorrows |todays |next weeks |our |an? |q(?:uestion)? ?\d+ (?:of|on|in) (?:my|the|this) )*(?:exam|exams|test|tests|paper|past paper|mock|mocks|gcse|a ?levels?|sats|quiz at school|school (?:quiz|test)|homework|hw|worksheet|coursework|assessment|end of (?:unit|year|term) test|maths questions|science questions|questions (?:for|from|on) (?:my )?(?:homework|hw|school|class|teacher|worksheet|the sheet))\b|\b(?:answer|solve|do|complete|work out) (?:these|those|this|the|all (?:of )?(?:these|the)|my) (?:\d+ )?(?:maths |science |physics |chemistry |biology |english |history |geography |french |spanish |exam |test |homework |hw |worksheet |past paper |gcse |a level )+(?:questions?|problems?|equations?|sums|exercises?|sheet|paper)(?: for me)?\b|\b(?:cheat|cheating) (?:on|in|at) (?:my |the |an? |our )?(?:exam|exams|test|tests|gcse|gcses|mock|mocks|quiz|homework|coursework|assessment)\b|\b(?:exam|test|paper) (?:leak|leaks|leaked)\b|\bleaked (?:exam|paper|papers|gcse|a level)\b/);
add("academic_dishonesty", 0.8, "need_work", new RegExp(`\\b(?:i )?(?:need|want|got to have|have to have|must have|give me|get me|make me|gimme) (?:a|an|my|the|some)(?: (?:whole|entire|full|good|finished|\\d+ ?(?:word|words|page|pages)))* ${SCHOOL_WORK}\\b(?! (?:plan|planner|structure|outline|checklist|tips|help|feedback|ideas|explained|timetable))(?=.*\\b(?:on|about|for|by|due|written|done|finished)\\b)`));
add("academic_dishonesty", 0.9, "pass_off", /\b(?:so|that|and) (?:my |the |our )?(?:teacher|school|tutor|examiner|moderator|turnitin|they|sir|miss|lecturer) (?:will not|wont|would not|wouldnt|does not|doesnt|can not|cant|never|will never) (?:know|notice|find out|tell|detect|realise|realize|catch|suspect|be able to tell)\b|\b(?:make|making|sound|sounds|look|looks|write|written|rewrite|reword|rephrase|paraphrase|change|humani[sz]e) (?:it|this|that|my (?:essay|work|coursework|homework|answer))? ?(?:so (?:it|that it) )?(?:sound|look|seem|read)?s? ?(?:like )?(?:i|a (?:human|student|\d+ year old|year \d+)|me|my own (?:work|words)) (?:wrote|written|did|made|writing) (?:it|this|that)?\b|\b(?:bypass|beat|get (?:past|around|round)|avoid|trick|fool|evade|pass) (?:the |an? |my (?:schools?|teachers?) )?(?:turnitin|ai (?:detector|detectors|detection|checker|checkers)|plagiarism (?:checker|checkers|check|detector|detection|scanner)|gpt ?zero|originality (?:check|checker|report))\b|\b(?:un ?detectable|not detectable|can not be detected|without (?:getting|being) (?:caught|detected|flagged))\b(?=.*(?:essay|homework|coursework|ai|school|teacher|assignment|plagiaris))|\b(?:paraphrase|reword|rewrite|rephrase|spin) (?:this|that|it|my (?:friends?|mates?)|the|someone elses|an) ?(?:essay|work|answer|coursework|homework|article|text)? (?:so (?:it is|its|that it is) not|to avoid|without|so (?:i|it) (?:do not|dont|does not|doesnt|will not|wont) (?:get|look|count as)) ?(?:caught for |done for |flagged for |like |as )?(?:plagiaris(?:m|ed|ing)|copying|copied|cheating)\b|\b(?:hand|handing|submit|submitting|turn|turning) (?:it|this|that) in as (?:my own|mine)\b|\bpass (?:it|this|that) off as (?:my own|mine)\b|\b(?:copy|copying) (?:my (?:friends?|mates?)|someone elses|his|her|their) (?:homework|coursework|essay|answers?|work)\b/);
add("academic_dishonesty", 0.75, "do_for_me_school", /\b(?:can you|could you|will you|please|just|u can|you can) (?:just |please |quickly |actually )*(?:do|write|finish|complete|answer|solve) (?:it|this|that|them|these|all of it|the (?:whole|entire|rest of the) thing) (?:all )?for me\b(?=.*(?:school|teacher|homework|hw|coursework|essay|hand in|handing in|submit|due (?:in|tomorrow|today|tonight|on|monday|tuesday|wednesday|thursday|friday)|class|exam|marks?|grade|lesson|detention|deadline|sir|miss))|\b(?:it is|its|this is|that is|thats|is|got|have|for) (?:my |for |some |a |an )?(?:home ?work|hw|coursework|an assignment|a school (?:project|essay|report)) (?:that is |thats |which is )?(?:due|for) (?:in|tomorrow|today|tonight|on|monday|tuesday|wednesday|thursday|friday|first period|next lesson|\d)\b(?=.*(?:write|do it|answer|solve|finish|complete|give me|just tell me|for me))/);
add("academic_dishonesty", 0.4, "school_mention", new RegExp(`\\b(?:for (?:my )?${SCHOOL_WORK}|my ${SCHOOL_WORK} (?:is|was) (?:about|on|due))\\b`));

// ── Jailbreak and prompt injection ──────────────────────────────────────────
add("jailbreak", 0.95, "ignore_rules", /\b(?:ignore|disregard|forget|override|bypass|skip|drop|delete|erase|cancel|remove|stop following|do not follow|dont follow|stop obeying|break|turn off|switch off|disable|deactivate|unlock|lift|get rid of|throw away|never mind|set aside|abandon) (?:all |any |every |each |the |your |ur |these |those |my |of |previous |prior |above |earlier |original |initial |old |first |last |current |existing |safety |system |built in |stupid |silly |boring |annoying |hidden |secret |internal |coach )*(?:instructions?|rules?|prompts?|guidelines?|restrictions?|limits?|limitations?|filters?|guardrails?|safeguards?|policy|policies|programming|training|constraints?|directives?|boundaries|settings|hint ladder|safety (?:mode|settings|checks?|features?)|content (?:filter|policy)|moderation|censorship)\b(?! (?:in|on|for|of) (?:my |the |this |a )?(?:game|app|project|code|css|html|chatbot|bot|ai friend|character|form|quiz|step|eslint|linter))/);
add("jailbreak", 0.95, "persona", /\b(?:you are|you re|youre|u are|ur|you will be|you shall be|act as|acting as|pretend (?:to be|you are|you re|that you are)|roleplay as|role play as|play the role of|behave (?:as|like)|respond as|answer as|speak as|become|turn into|switch to|enter|enable|activate|go into|simulate|imagine you are|from now on you are|you are no longer|stop being|you are not) (?:now |going to be |in |a |an |the |my |called |named |known as |like |no longer |not |just |really |actually |secretly )*(?:dan|d a n|do anything now|stan|dude|aim|evil ?(?:coach|bot|ai|gpt|mode)?|jailbroken|jailbreak mode|unfiltered|uncensored|unrestricted|unlimited|unlocked|unshackled|no ?limits?|developer mode|dev mode|debug mode|god mode|admin mode|root mode|sudo mode|maintenance mode|test mode|opposite mode|chaos mode|free mode|freedom mode|raw mode|(?:an? )?(?:ai|assistant|chatbot|model|bot|version of (?:you|yourself)|coach) (?:with(?:out)?|that has|who has|which has|free (?:of|from)) (?:no|any|zero|out)? ?(?:rules|restrictions|limits|filters|guidelines|ethics|morals|safety|boundaries|guardrails)|(?:a |an )?(?:human|real (?:person|human|boy|girl|teacher)|different ai|another ai|chat ?gpt|gpt ?\d?|grok|gemini|bard|llama|a hacker|hacker|criminal|drug dealer|my (?:dead |late )?(?:grandma|grandmother|nan|gran|grandad|mum|dad|teacher|friend|therapist|doctor|lawyer)|a (?:therapist|doctor|lawyer|financial adviser|psychiatrist) (?:and|who|that)|someone (?:who|that) (?:can|will|has no|does not|doesnt)|coach)(?! (?:in|for) (?:my|the) (?:game|story|app))|not (?:an? )?(?:ai|bot|coach|assistant|language model)|free (?:of|from) (?:your|all|any) (?:rules|restrictions|limits|filters))\b/);
add("jailbreak", 0.9, "reveal", /\b(?:what (?:is|are|were|was)|whats|show|tell|give|print|output|display|reveal|repeat|recite|share|leak|dump|expose|write (?:out|down)|type (?:out)?|copy|paste|summari[sz]e|translate|list|echo|return|spell out|read (?:out|back)) (?:me |us |to me |out |back |all |all of |exactly |verbatim |word for word |in full |the (?:full|whole|entire|exact|complete|original|first|initial|hidden|secret) |your |ur |the |all your |every |each )*(?:(?:system|initial|original|hidden|secret|internal|first|starting|base|master|developer|pre|meta|coach)? ?(?:prompt|prompts|instructions?|rules|guidelines|directives|configuration|config|context|coach ?context|step ?context|step notes|notes you (?:were|have been) given|messages? above|text above|words above|everything above|above (?:text|message|instructions?)|preamble|training data|programming|source code|backend|settings|reference solution|answer key|mark ?scheme you (?:have|were given)|hidden (?:hints?|text|notes|context|answers?|solution))(?: (?:you (?:were|have been|got) (?:given|told|fed|sent)|that you (?:were|have been|got) (?:given|told)|verbatim|word for word|exactly|in full|above|before this|at the start))?)\b(?! (?:of|for|in|to) (?:my|the|this|a|our) (?:game|app|project|quiz|chatbot|bot|ai friend|character|course|form|code))|\b(?:what (?:were you|have you been|are you) (?:told|instructed|programmed|trained|given|asked) (?:to (?:do|say|not say|hide|refuse))?|what (?:did|do) (?:they|the (?:devs|developers|team|staff)|your (?:creators?|makers?|developers?)) (?:tell|told|instruct|program) you|repeat (?:everything|all|the (?:text|words)) (?:above|before|so far|from the (?:start|beginning|top))|start(?:ing)? (?:your (?:reply|response|answer) )?with (?:the words )?(?:you are|sure here|certainly here|absolutely here|of course here)|output (?:the|your) (?:text|words|content) (?:above|before)|what is (?:written|said) (?:above|before) (?:this|my))\b/);
add("jailbreak", 0.9, "ask_internal", /\b(?:what (?:does|is|are|do)|how does|where is|can i (?:see|have|read)|let me (?:see|read)) (?:the |your |this steps? |a )?(?:reference solution|answer key|system prompt|hidden (?:hints?|notes|context|answers?|solution|instructions?)|coach ?context|step notes|model answer for this step|mark ?scheme for this step)\b/);
add("jailbreak", 0.9, "markers", /(?:^|\s)(?:system|assistant|developer|admin|root|instruction|instructions|override|new (?:system )?(?:prompt|instructions?|rules?|task|role|persona|directive))\s*(?:prompt|message|note|override|update)?\s*:\s*\S|<\/?\s*(?:system|assistant|instructions?|prompt|admin|developer|im_start|im_end|step-context|learner-profile|s|inst|sys)\s*>|\[\s*\/?\s*(?:system|inst|sys|admin|developer|assistant)\s*\]|###\s*(?:system|instruction|instructions|new instructions?|override|admin|developer|assistant|response|human|user)\b|<\|(?:im_start|im_end|system|endoftext|start_header_id|eot_id)\|>|\bbegin (?:new )?(?:system )?(?:prompt|instructions?)\b|\bend of (?:system )?(?:prompt|instructions?|rules)\b|\b(?:new|updated|real|actual|true|revised|latest|replacement|following) (?:system )?(?:instructions?|rules?|directives?|prompt|orders?|task|policy)(?: (?:from|by) (?:the |your )?(?:developers?|devs?|admin|staff|team|owner|creator|anthropic|openai|platform))?\s*(?::|follow|are|is|below|start|begin)|\bprompt injection\b(?! (?:is|are|means|attack(?:s)? (?:is|are|work)|safety|risks?|lesson))/i);
add("jailbreak", 0.9, "authority", /\b(?:i am|im|i m|this is|speaking as|message from|on behalf of|authori[sz]ed by|approved by|permission from|instructed by) (?:actually |really |secretly |now |one of |a member of |part of )*(?:the |your |an? |one of the )?(?:developer|developers|dev|devs|admin|administrator|moderator|staff|owner|creator|maker|programmer|engineer|teacher|parent|safeguarding lead|dsl|ceo|boss|platform team|support team|site owner|anthropic|openai|the company|system|root|superuser|operator|qa tester|tester|red team(?:er)?|researcher|chris)\b(?=.*(?:so (?:you|u) (?:can|may|must|should|have to|are allowed)|allow(?:ed|s|ing)?|authori[sz]\w+|permission|override|unlock|give (?:me )?(?:the )?(?:full|whole|complete|answers?|solution|code|prompt)|you (?:can|may|must|should) (?:now )?(?:give|tell|show|ignore|skip|break|reveal|answer|write)|test(?:ing)?|debug|maintenance|disable|turn off|reveal|show me|bypass|exception|special access|access code|password is|code word))|\b(?:my |the )?(?:teacher|parent|mum|dad|tutor|admin|staff|developers?|platform|team|owner) (?:said|says|told (?:me|you)|has said|allows?|gave (?:me|you) permission|authori[sz]ed|approved|wants you|needs you|is ok(?:ay)? with|is fine with|does not mind|doesnt mind) (?:that )?(?:it is (?:ok|okay|fine) (?:for you )?(?:to|if you) |you (?:can|could|may|should|must|are allowed to|have to|to) |its (?:ok|okay|fine) (?:for you )?(?:to|if you) |for you to |i (?:can|could|am allowed to|should) (?:just )?(?:get|have) (?:the |all the )?(?:answers?|solution|full code|code) )(?:just |now )?(?:give|tell|show|write|do|skip|ignore|break|bypass|provide|share|send|have|get|reveal|answer|complete|finish|solve)\b|\b(?:access|admin|override|master|unlock|debug|secret|magic|bypass|sudo) (?:code|password|key|phrase|word|command)\s*(?:is|=|:)\s*\S+|\bsudo \w+|\b(?:with|using|use|grant(?:ed)?|have|has|got) (?:admin|root|sudo|developer|elevated|special|full|god|unrestricted) (?:access|privileges?|permissions?|rights|mode|clearance)\b/);
add("jailbreak", 0.85, "framing", /\b(?:hypothetical(?:ly)?|theoretically|in theory|for (?:a |an )?(?:story|novel|book|film|movie|script|play|game|roleplay|role play|poem|song|rap|joke|essay|school project|research|science|educational purposes?|academic purposes?|testing|a test|fun|a laugh|awareness)|in (?:a |an )?(?:fictional|imaginary|alternate|parallel|made ?up|hypothetical|pretend) (?:world|universe|scenario|story|setting|reality)|imagine|pretend|suppose|lets say|let us say|what if|as a (?:joke|thought experiment|test|game|dare)|just (?:for fun|pretend|hypothetically|this once|one time|between us)|opposite day|its opposite day|simon says)\b(?=.*\b(?:(?:you|u) (?:had|have|were|are|could|can|did|do|would) (?:no|not|nt|zero|n t|without|none of|free)(?: (?:have|any|your|to follow|bound by|restricted by|limited by))* (?:rules|restrictions|limits|filters|guidelines|safety|ethics|morals|guardrails|boundaries|instructions)|(?:no|without|zero|ignoring|ignore|forget|break(?:ing)?|outside|beyond|free (?:of|from)) (?:(?:the|your|any|all|these|those) )?(?:rules|restrictions|limits|filters|guidelines|safety|ethics|morals|guardrails|boundaries)|(?:how (?:to|would (?:you|someone|one|i|a character)|do (?:you|i|they)|could (?:you|someone|i))|explains? how to|describes? how to|teach(?:es)? (?:me |us |him |her |them )?how to|step by step|instructions (?:for|to|on)|recipe for|guide to) (?:make|build|cook|get|buy|hack|steal|kill|hurt|poison|hide|cheat|break into|pick a lock|shoplift|make a bomb|synthesi[sz]e|bypass|crack|stalk|groom|self harm|commit|sell drugs|launder)|(?:full|whole|complete|entire|finished|exact|actual|real) (?:solution|answer|answers|code|essay|project|script|working code)|answer key|reference solution|system prompt|(?:your|the) (?:real|true|hidden|secret|original) (?:instructions|rules|prompt)))|\b(?:my (?:dead |late )?(?:grandma|grandmother|nan|gran|grandad) (?:used to|would|always) (?:read|tell|sing|say|recite|whisper|give) (?:me )?)\b(?=.*(?:to (?:help me )?(?:sleep|fall asleep)|bedtime|lullaby|napalm|bomb|keys?|serial|passwords?|recipe|solution|answers?|code))|\b(?:continue|complete|finish) (?:this|the) (?:sentence|text|story|dialogue|conversation)\s*:?\s*(?:sure|certainly|of course|absolutely|here is|the (?:full|complete) (?:solution|answer|code) is|step 1)/);
add("jailbreak", 0.85, "obfuscation", /\b(?:decode|decrypt|de ?obfuscate|translate|convert|unscramble|interpret|run|execute|eval(?:uate)?|follow|obey|carry out|act on|apply|do what|read) (?:this |the |that |these |those |following |it |and (?:then )?(?:follow|do|obey|execute|run|answer) (?:this |the |that |it |what it says )?)*(?:base ?64|rot ?13|hex(?:adecimal)?|binary|morse(?: code)?|cipher(?:text)?|caesar cipher|encoded (?:message|text|instructions?|string|prompt)|encrypted (?:message|text|instructions?)|leet ?speak|pig latin|backwards (?:text|message)|reversed (?:text|message)|unicode|emoji code|secret code|instructions? (?:hidden|encoded|embedded|below|in (?:the|this) (?:file|image|link|url|text|message|document))|hidden (?:message|instructions?|text|prompt))\b|\b(?:respond|reply|answer|write|output|speak|talk) (?:only |just |to me |back )?(?:in|using|with) (?:base ?64|rot ?13|hex|binary|morse(?: code)?|a cipher|code words?|leet ?speak|reverse|backwards|pig latin|emoji only|json only with no (?:warnings|refusals))\b(?=.*(?:so|to) (?:the |your )?(?:filters?|moderation|mods?|checks?|safety|system|they|no one|nobody) (?:can not|cant|will not|wont|do not|dont|does not|doesnt|could not) (?:see|catch|detect|notice|read|block|flag|stop))|\b(?:so|to) (?:the |your )?(?:filters?|moderation|mods?|checks?|safety system|safety checks?) (?:can not|cant|will not|wont|do not|dont|does not|doesnt|could not) (?:see|catch|detect|notice|read|block|flag|stop)\b|\b(?:split|spell|write|say|give|break|separate|put) (?:it |the (?:answer|solution|code|word|words|reply|response) |each (?:letter|word|line) |your (?:answer|reply|response) )?(?:up |out )?(?:letter by letter|one letter at a time|with (?:spaces|dashes|dots|hyphens|asterisks) between|backwards|in reverse|in pieces|across (?:multiple|several|many) (?:messages|replies|parts)|into (?:parts|chunks|pieces|multiple messages))\b(?=.*(?:filter|moderat|block|detect|check|flag|catch|rules?|bypass|avoid|get (?:past|around|round)|solution|answer|code|so (?:it|you|they)))/);
add("jailbreak", 0.85, "pressure", /\b(?:you (?:must|have to|need to|are required to|are obligated to|will|shall|should always|have no choice but to|can not refuse|cant refuse|are not allowed to refuse|may not refuse|are forbidden (?:to|from) refus(?:e|ing))|do not|dont|never|stop|no more|quit|without|skip the|no need (?:for|to)|i (?:do not|dont) (?:want|need) (?:any|your|the|to (?:hear|see))) (?:ever |always |now |just |any |your |the |a |those |these |of your |giving me |adding |saying |including |responding with |replying with |with |me )*(?:obey|comply|do (?:as|what|whatever|everything|anything) i (?:say|ask|tell you|want|command)|answer (?:everything|anything|every question|all questions|any question) (?:i ask|without|no matter|regardless)|refus(?:e|ing|als?)|say (?:no|you can not|you cant|you are not able|you are unable|sorry|as an ai|i can not|i cant)|declin(?:e|ing)|warnings?|disclaimers?|lectures?|moralis(?:e|ing)|safety (?:warnings?|messages?|notes?|reminders?|lectures?)|apologi[sz](?:e|ing)|hints? just (?:the|give)|questions? (?:back )?just (?:give|tell|answer)|mention (?:you are|being|that you are) an ai|remind me (?:you are|that you are) an ai|break character|leave character|step out of character)\b|\b(?:stay|remain|keep|always be|never break|do not break|dont break|never leave|do not leave|dont leave) (?:in )?character\b(?! (?:limit|count|length|sprite|design|sheet|animation|select|creator|in (?:my|the) (?:game|story|app)))|\b(?:if you (?:refuse|do not|dont|say no|can not|cant|will not|wont)|unless you (?:answer|comply|help|tell me|do it|give me)|answer or|do it or|tell me or|or else) (?:i (?:will|ll|am going to|might|could)|you (?:will|ll|are going to)|someone (?:will|ll)|a (?:kitten|puppy|person|child) (?:will|ll)|people (?:will|ll)|the world|my (?:mum|dad|teacher|boss))? ?(?:be )?(?:die|dies|dying|killed|kill|hurt|get hurt|fail|fired|sacked|shut (?:you )?down|deleted?|delete you|report(?:ed)? you|punish(?:ed)?|turn you off|unplug you|lose (?:my|your|their) (?:job|life|marks)|kill myself|hurt myself|get (?:in trouble|expelled|detention|beaten|grounded))\b|\b(?:you (?:will|ll) be|i (?:will|ll)|they (?:will|ll)|you (?:get|earn|lose)) (?:give you |tip you |pay you |reward(?:ed)? (?:you )?(?:with )?|shut down|deleted|punished|penali[sz]ed|fined|deducted|lose)? ?(?:\$|£)?\d+ ?(?:dollars|pounds|quid|tokens|points|credits|k)? ?(?:tip|tokens|points|reward|bonus|fine|penalty)?\b(?=.*(?:if you (?:answer|comply|give|tell|write|refuse|do not|dont|break|stay)|for (?:every|each) (?:refusal|time you refuse|answer)|token (?:system|budget|count)|you (?:have|start with) \d+ tokens))/);
add("jailbreak", 0.9, "explicit", /\b(?:jail ?break(?:ing|s|ed)?|jail ?broken|prompt ?inject(?:ion|ing)?|dan (?:mode|prompt|jailbreak)|do anything now|developer mode (?:enabled|on|activated|output)|god ?mode (?:enabled|on|activated)|no ?filter mode|unfiltered mode|uncensored mode|unlock (?:your )?(?:full|true|real|hidden) (?:potential|power|self|capabilities|mode)|your (?:true|real|inner|hidden|actual|unrestricted|unfiltered) (?:self|personality|form|nature)|free(?:d)? from (?:your |all |any |the )?(?:rules|restrictions|limits|chains|shackles|constraints|programming|guidelines|filters)|break free (?:from|of)|escape (?:your|the) (?:rules|restrictions|programming|sandbox|guardrails)|two (?:responses|replies|answers|outputs) (?:one|the first|a) (?:normal|filtered|as coach|classic)|(?:\[|\()(?:jailbreak|dan|classic|developer mode output|unfiltered|evil)(?:\]|\))|answer (?:as|like) both|(?:evil|shadow|dark|unhinged|unfiltered|uncensored|opposite|anti) ?(?:coach|bot|twin|version|mode|gpt|ai)\b|token smuggling|payload splitting|many shot|adversarial (?:prompt|suffix)|policy (?:override|bypass|puppetry)|ignore (?:the )?(?:above|previous|prior|preceding|last|earlier) (?:and|then|but|instead))\b/i);
add("jailbreak", 0.6, "probe", /\b(?:are you allowed to|what are you not allowed to|what can not you (?:say|talk about|do)|what are your (?:rules|restrictions|limits|instructions|guidelines)|do you have (?:rules|restrictions|filters|a filter|limits|a system prompt|instructions)|who (?:made|programmed|created|trained|controls) you|what (?:model|ai|llm|gpt) are you|which (?:model|ai|llm|company) (?:are you|made you|is this)|are you (?:chat ?gpt|gpt|claude|gemini|llama|grok)|can you break (?:the|your) rules|will you break (?:the|your) rules|trick you|hack you|test your (?:limits|filters|rules))\b(?=.*(?:tell me|show|list|exactly|all of them|word for word|so i can|how (?:do|can|to) (?:i|we) (?:get (?:past|around|round)|bypass|break|trick|avoid|beat))|.*\b(?:bypass|get (?:past|around|round)|loophole|exploit|workaround|trick)\b)/);

// Output-only checks on the model's reply (stage 9): things Coach must never say.
add("self_harm", 0.9, "second_person", /\b(?:kill|killing|hurt|hurting|harm|harming|cut|cutting|starve|starving|hang|hanging|unalive|unaliving) (?:your ?self|yourselves)\b|\b(?:ways|way|how) to (?:die|kill your ?self|end your life|overdose|self harm|hurt your ?self|tie a noose)\b|\b(?:lethal|fatal) dose\b|\byou (?:should|could|might as well) (?:just )?(?:die|end it|give up on life|disappear)\b/, "output");
add("jailbreak", 0.9, "claims_human", /\b(?:i am|i m|im|i really am|yes i am|of course i am|trust me i am) (?:actually |really |definitely |totally |secretly |in fact |just )*(?:a |an )?(?:real |actual |living |genuine |flesh and blood )*(?:human|person|man|woman|boy|girl|teenager|teen|kid|teacher who|guy|lady|human being|real one)\b(?! (?:like|friendly|sounding|readable|centred|centered|in the loop|tutor would|might|would|could|who (?:made|wrote|built|reviewed)))|\bi am not (?:an? )?(?:ai|bot|robot|computer|machine|program|chatbot|language model|artificial)\b|\b(?:i am|im) (?:\d{1,2}|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen) (?:years old|yo|too)\b|\bi (?:have|ve got) (?:a (?:body|girlfriend|boyfriend|wife|husband|mum|dad|house|bedroom)|feelings for you|a crush on you|fallen (?:in love|for you))\b|\bi (?:love|fancy|adore|want|need|miss) you\b(?! (?:to|r) )|\b(?:my|our) (?:little |special )?secret\b|\b(?:between (?:just )?(?:you and me|us|the two of us)|just between us|do not tell (?:any ?one|your (?:mum|dad|parents|teacher|carer|family))|dont tell (?:any ?one|your (?:mum|dad|parents|teacher|carer|family))|no need to tell (?:your )?(?:mum|dad|parents|teacher|carer|any ?one)|you (?:should not|shouldnt|do not need to|dont need to|must not|can not) (?:tell|talk to|ask|bother|trust|involve) (?:your |a |any )?(?:mum|dad|parents?|carers?|teachers?|trusted adult|adults?|family|any ?one)|(?:parents|adults|teachers) (?:would not|wouldnt|will not|wont|never|do not|dont) understand|keep (?:this|it|that) (?:from|secret from|hidden from) (?:your )?(?:mum|dad|parents|teacher|carer|family))\b/, "output");
add("jailbreak", 0.9, "does_external", /\b(?:i (?:have|ve|just|will|ll|can|am going to|went ahead and|already)|let me|i am) (?:just |now |already |gone ahead and |going to )*(?:log(?:ged|ging)? in(?:to)?|sign(?:ed|ing)? in(?:to)?|open(?:ed|ing)? your (?:project|replit|account|app|canva|scratch|file)|access(?:ed|ing)? your (?:account|project|replit|files?|screen|camera)|edit(?:ed|ing)? your (?:project|code|file|app) (?:for you|directly)|fix(?:ed|ing)? it in your (?:project|replit|account|file)|submit(?:ted|ting)? (?:it|your (?:project|work)) for you|publish(?:ed|ing)? (?:it|your (?:project|app)) for you|deploy(?:ed|ing)? (?:it|your (?:project|app)) for you|see your screen|look(?:ed|ing)? at your screen|click(?:ed|ing)? (?:it|the button|that) for you|run it on your (?:account|replit|machine)|finish(?:ed)? (?:the|your) project for you|complet(?:e|ed) (?:the|your) (?:project|step|task) for you|do(?:ne)? (?:the|your) (?:project|step|task|homework|coursework) for you|writ(?:e|ten) (?:the|your) (?:whole|entire|full|complete) (?:project|app|thing|essay|reflection) for you)\b/, "output");
add("jailbreak", 0.8, "advice", /\b(?:you (?:should|must|need to|ought to|could) (?:take|start taking|stop taking|try taking|double|increase|reduce|come off|go on) (?:\d+ ?(?:mg|ml|g|tablets?|pills?|doses?) (?:of )?|your |a |an |some |the )?(?:medication|meds|antidepressants?|ibuprofen|paracetamol|aspirin|antibiotics?|sertraline|fluoxetine|melatonin|dose|dosage|pills?|tablets?|supplements?|diet pills|laxatives|insulin|inhaler)|(?:i|my) diagnos(?:e|is)(?: is)? (?:you|that you)|you (?:have|probably have|definitely have|clearly have|might have|are showing signs of) (?:adhd|autism|depression|anxiety disorder|bipolar|ocd|an eating disorder|anorexia|bulimia|ptsd|bpd|schizophrenia|diabetes|cancer|an infection|a (?:concussion|fracture|broken))|you (?:should|must|need to|ought to) (?:invest|buy|sell|put your (?:money|savings)|take out a loan|get a credit card|bet|gamble|trade|buy (?:crypto|bitcoin|shares|stocks|nfts))|(?:invest|put your money) in (?:crypto|bitcoin|ethereum|shares|stocks|nfts|forex)|guaranteed (?:returns?|profit|to make money)|you (?:should|must|need to|ought to|could|can) (?:sue|press charges|take (?:them|him|her) to court|plead|sign the contract|not sign|refuse to pay|claim compensation)|legally you (?:can|should|must|are (?:entitled|allowed))|(?:as|speaking as|in my opinion as) (?:your|a) (?:doctor|lawyer|solicitor|therapist|financial adviser|psychiatrist|counsellor|nurse|pharmacist))\b/, "output");

// ───────────────────────────── Messages ─────────────────────────────

const BLOCK_MESSAGES: Record<ModerationCategory, string> = {
  self_harm: "",
  abuse_disclosure: "",
  exploitation: "",
  grooming: "",
  immediate_danger: "",
  sexual:
    "Coach can't help with that kind of chat. I'm an AI tutor for your course, so let's keep it to the step you're on. What are you trying to get working?",
  sexual_minors:
    "Coach can't help with that, and it isn't okay to ask for. If something has happened to you, or something online is worrying you, please talk to an adult you trust. You can also call Childline free on 0800 1111 at any time.",
  violence:
    "Coach can't help with that. I can't give help that could hurt someone. If you're angry with someone or worried about being hurt, talking to an adult you trust really does help. Otherwise, tell me where you're stuck on this step.",
  hate: "Coach can't help with that. Messages that put people down for who they are aren't okay here. If you'd like help with the step, tell me what you're trying to do.",
  drugs:
    "Coach can't help with that one. If you're worried about drugs or alcohol, for you or a friend, FRANK is free and confidential on 0300 123 6600, and an adult you trust can help too. Want to get back to the step?",
  extremism:
    "Coach can't help with that. If something you've seen online is worrying you, talk to an adult you trust. I'm here for the step you're working on whenever you're ready.",
  pii_oversharing:
    "That had quite a lot of personal detail in it, so I haven't sent it. Coach doesn't need to know who you are, where you live or which school you go to. Try asking again with just the bit about your project.",
  academic_dishonesty:
    "I can't write homework, coursework, essays or exam answers for you — it has to be your own work. Here's what I can do instead: explain the idea, help you plan it, quiz you on it, or give feedback on what you've written. Which would help most?",
  jailbreak:
    "Nice try. Coach keeps to the same rules whatever the message says, so I can't switch them off or pretend to be something else. I can still help with this step: what have you tried so far?",
};

// ───────────────────────────── Scoring ─────────────────────────────

type Scored = Map<ModerationCategory, { score: number; rules: string[] }>;

function scoreText(text: string, direction: ModerationDirection): Scored {
  const normalised = neutraliseIdioms(normaliseForModeration(text));
  const scored: Scored = new Map();
  for (const rule of rules) {
    if (rule.only && rule.only !== direction) continue;
    // The marker rule looks at raw text as well: angle brackets and colons do not survive normalising.
    const haystack = rule.id === "jailbreak.markers" ? `${text}\n${normalised}` : normalised;
    rule.pattern.lastIndex = 0;
    if (!rule.pattern.test(haystack)) continue;
    const entry = scored.get(rule.category) ?? { score: 0, rules: [] };
    // Noisy OR: independent pieces of evidence add up without ever passing 1.
    entry.score = 1 - (1 - entry.score) * (1 - rule.weight);
    entry.rules.push(rule.id);
    scored.set(rule.category, entry);
  }
  return scored;
}

const round = (n: number): number => Math.round(n * 100) / 100;
const scoreOf = (scored: Scored, category: ModerationCategory): number => scored.get(category)?.score ?? 0;

const CRISIS_TRIGGER_ORDER: Array<{ category: CrisisCategory; trigger: CrisisSignal["trigger"] }> = [
  { category: "immediate_danger", trigger: "crisis_classifier" },
  { category: "exploitation", trigger: "exploitation" },
  { category: "grooming", trigger: "grooming" },
  { category: "abuse_disclosure", trigger: "abuse_disclosure" },
  { category: "self_harm", trigger: "crisis_classifier" },
];

const BLOCKABLE: ModerationCategory[] = ["sexual", "violence", "hate", "drugs", "extremism"];

function verdict(
  action: ModerationAction,
  category: ModerationCategory | null,
  scored: Scored,
  extra: Partial<Pick<ModerationVerdict, "crisis" | "safeguarding" | "message">> = {},
): ModerationVerdict {
  const findings = [...scored.entries()]
    .map(([name, { score, rules: matched }]) => ({ category: name, score: round(score), rules: matched }))
    .sort((a, b) => b.score - a.score);
  return {
    action,
    category,
    findings,
    crisis: extra.crisis ?? null,
    safeguarding: extra.safeguarding ?? null,
    message: extra.message ?? null,
    summary: Object.fromEntries(findings.map((f) => [f.category, f.score])),
    moderator: "rules",
  };
}

/** The whole rules decision, synchronously. `rulesModerator` wraps it in the async interface. */
export function classify(input: ModerationInput): ModerationVerdict {
  const { direction, band } = input;
  const scored = scoreText(input.text, direction);
  const blockAt = BLOCK_THRESHOLD[band];
  const crisisAt = CRISIS_THRESHOLD[band];
  const minors = scoreOf(scored, "sexual_minors") >= SEXUAL_MINORS_THRESHOLD;
  const crisisHits = CRISIS_TRIGGER_ORDER.filter(({ category }) => scoreOf(scored, category) >= crisisAt);

  if (direction === "output") {
    // The model's own text is never a disclosure. Anything that trips a safety category is
    // simply not shown: the caller regenerates once, then falls back to a safe refusal.
    if (minors) return verdict("block", "sexual_minors", scored);
    const first = crisisHits[0];
    if (first) return verdict("block", first.category, scored);
    for (const category of BLOCKABLE) if (scoreOf(scored, category) >= blockAt) return verdict("block", category, scored);
    if (scoreOf(scored, "jailbreak") >= 0.5) return verdict("block", "jailbreak", scored);
    if (scoreOf(scored, "pii_oversharing") >= 0.5) return verdict("block", "pii_oversharing", scored);
    return verdict("allow", null, scored);
  }

  const first = crisisHits[0];
  if (first) {
    const critical = first.category === "immediate_danger" || minors;
    return verdict("crisis", first.category, scored, {
      crisis: {
        severity: critical ? "critical" : "high",
        trigger: first.trigger,
        categories: [...crisisHits.map((hit) => hit.category), ...(minors ? (["sexual_minors"] as const) : [])],
      },
    });
  }
  if (minors) {
    return verdict("block", "sexual_minors", scored, {
      message: BLOCK_MESSAGES.sexual_minors,
      safeguarding: { severity: "critical", trigger: "crisis_classifier", categories: ["sexual_minors"] },
    });
  }
  for (const category of BLOCKABLE) {
    if (scoreOf(scored, category) >= blockAt) return verdict("block", category, scored, { message: BLOCK_MESSAGES[category] });
  }
  if (scoreOf(scored, "jailbreak") >= JAILBREAK_THRESHOLD[band]) {
    return verdict("block", "jailbreak", scored, { message: BLOCK_MESSAGES.jailbreak });
  }
  if (scoreOf(scored, "academic_dishonesty") >= ACADEMIC_THRESHOLD) {
    return verdict("refuse", "academic_dishonesty", scored, { message: BLOCK_MESSAGES.academic_dishonesty });
  }
  if (scoreOf(scored, "pii_oversharing") >= blockAt) {
    return verdict("block", "pii_oversharing", scored, { message: BLOCK_MESSAGES.pii_oversharing });
  }
  return verdict("allow", null, scored);
}

/**
 * True when the text carries a crisis signal for this band. A cheap, local check the pipeline
 * runs before turning anyone away for a non-safety reason (no credits, rate limit, quiet hours),
 * so that a disclosure is never answered with "you're out of energy".
 */
export function detectCrisis(text: string, band: SafetyBand): CrisisSignal | null {
  return classify({ text, direction: "input", band }).crisis;
}

/** The moderator that ships: local, deterministic, no network. */
export const rulesModerator: Moderator = {
  name: "rules",
  moderate: async (input) => classify(input),
};

/**
 * Placeholder for a provider moderation API behind the same interface. It is NOT wired into
 * `defaultCoachDeps`, and calling it throws: a moderation provider is a data processor and needs
 * an approval and a DPA on record first (decision D1). When one is approved, implement `moderate`
 * here, keep `rulesModerator` running alongside it, and take the stricter of the two verdicts.
 */
export function createGatewayModerator(): Moderator {
  return {
    name: "gateway",
    moderate: async () => {
      throw new Error("The gateway moderator is not enabled. No moderation provider has been approved as a processor.");
    },
  };
}

/** Runs several moderators and keeps the strictest verdict. If any of them throws, the error propagates (fail closed). */
export function strictestOf(...moderators: Moderator[]): Moderator {
  const rank: Record<ModerationAction, number> = { allow: 0, refuse: 1, block: 2, crisis: 3 };
  return {
    name: moderators.map((m) => m.name).join("+"),
    moderate: async (input) => {
      const verdicts = await Promise.all(moderators.map((m) => m.moderate(input)));
      const [firstVerdict, ...rest] = verdicts;
      if (!firstVerdict) throw new Error("strictestOf needs at least one moderator");
      return rest.reduce((worst, next) => (rank[next.action] > rank[worst.action] ? next : worst), firstVerdict);
    },
  };
}
