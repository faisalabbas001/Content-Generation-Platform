import { useState, useRef, useEffect, useMemo } from "react";

const C = {
  bg:"#0A0908", card:"#141312", cardHi:"#1C1A17", border:"#252320", borderHi:"#383530",
  text:"#F0EDE8", textDim:"#A09B92", muted:"#6B6860", subtle:"#3A3733",
  rec:"#C9A84C", recBg:"#1A1508",
  green:"#22c55e",
  sans:"'DM Sans',system-ui,-apple-system,sans-serif",
  serif:"'Fraunces','Playfair Display',Georgia,serif",
  mono:"'JetBrains Mono','Courier New',monospace",
};

function useFonts(){
  useEffect(()=>{
    if(document.getElementById("ogz-fonts"))return;
    const l=document.createElement("link");
    l.id="ogz-fonts";
    l.rel="stylesheet";
    l.href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,800;9..144,900&family=Bebas+Neue&family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=JetBrains+Mono:wght@400;500;600&display=swap";
    document.head.appendChild(l);
  },[]);
}

// haptic feedback (silent if unsupported)
const haptic=(d=10)=>{try{navigator.vibrate&&navigator.vibrate(d);}catch{}};

const CHAPTERS = [
  {id:1,label:"Foundation",sub:"Who you are",color:"#C9A84C",bg:"#1A1508",range:[1,4],family:"A"},
  {id:2,label:"The Feel",sub:"Aesthetic & mood",color:"#7C6AF5",bg:"#0E0C1A",range:[5,9],family:"A+E"},
  {id:3,label:"The Voice",sub:"How you communicate",color:"#E5667A",bg:"#1A0B0E",range:[10,14],family:"A+B"},
  {id:4,label:"The Business",sub:"Market & positioning",color:"#3DB88A",bg:"#091511",range:[15,18],family:"E+C"},
  {id:5,label:"The Vision",sub:"Where you're going",color:"#A78BFA",bg:"#110E1A",range:[19,20],family:"D"},
];

const SECTORS=[
  {v:"fnb",e:"🍽",l:"Food & Beverage",d:"Restaurants, cafés, FMCG, sweets",accent:"#E5A04C"},
  {v:"beauty",e:"💄",l:"Beauty & Personal Care",d:"Skincare, perfume, cosmetics, salons",accent:"#D67BB2"},
  {v:"retail",e:"🛍",l:"Retail & Fashion",d:"Apparel, jewellery, accessories, home",accent:"#7BC4D6"},
  {v:"other",e:"✨",l:"Something Else",d:"We'll map you to the closest sector",accent:"#C9A84C"},
];

const heroProductCopy = (s) => ({
  fnb:{label:"Show us your hero dish",hint:"The one customers come back for"},
  beauty:{label:"Show us your hero product",hint:"The one your customers can't run out of"},
  retail:{label:"Show us your hero piece",hint:"Your bestseller, your signature, your icon"},
  other:{label:"Show us your hero product",hint:"The one customers come back for"},
}[s]||{label:"Show us your hero product",hint:"The one customers come back for"});

const heroWhyCopy = (s) => ({
  fnb:"What makes this dish the one people order again?",
  beauty:"What makes this product the one people repurchase?",
  retail:"What makes this piece the one people tell friends about?",
  other:"What makes this the one customers return for?",
}[s]||"What makes this the one customers return for?");

const SCALES=[
  {k:"scale_minmax",left:"Minimal",right:"Maximal",hint:"Restraint or abundance"},
  {k:"scale_quietloud",left:"Quiet",right:"Loud",hint:"Calm presence or attention-grabbing"},
  {k:"scale_localglobal",left:"Local",right:"Global",hint:"Rooted in place or world-facing"},
  {k:"scale_tradmod",left:"Traditional",right:"Modern",hint:"Heritage or contemporary"},
];

const BRANDS=["Nike","Apple","Zara","Starbucks","H&M","Louis Vuitton","IKEA","McDonald's","Rolex","Chanel","Adidas","Amazon","Gucci","Lululemon","Dyson","Glossier","Aesop","Dior","Sephora","Bath & Body Works","Noon","Namshi","Jarir","Centrepoint","Carrefour","Panda","Aldo","Shein","Netflix","Samsung"];

const LIFESTYLES=[
  {v:"family_home",e:"🏠",l:"Family Home Evening",d:"Cooking, gathering, warmth"},
  {v:"coffee_solo",e:"☕",l:"Coffee Shop Solo",d:"Working, discovering, scrolling"},
  {v:"mall_friends",e:"🛍",l:"Mall with Friends",d:"Shopping, socialising, trending"},
  {v:"gym",e:"💪",l:"Active & Health-Conscious",d:"Gym, clean eating, self-care"},
  {v:"gathering",e:"🕯",l:"Home Gathering",d:"Hosting, entertaining, sharing"},
  {v:"outdoor",e:"🌿",l:"Outdoor & Adventure",d:"Travel, exploration, freedom"},
];

// Each emotion has a color — Q9 picks blend into the brand preview
const EMOTIONS=[
  {l:"Inspired",c:"#F5C85C"},{l:"Reassured",c:"#7BC4D6"},{l:"Excited",c:"#E5667A"},
  {l:"Proud",c:"#C9A84C"},{l:"Curious",c:"#7C6AF5"},{l:"Nostalgic",c:"#D67BB2"},
  {l:"Impressed",c:"#3DB88A"},{l:"Included",c:"#A8D67B"},{l:"Understood",c:"#7B95D6"},
  {l:"Motivated",c:"#E58A4C"},{l:"Confident",c:"#1E3A5F"},{l:"Sophisticated",c:"#2A2438"},
  {l:"Energized",c:"#FF6F4C"},{l:"Calm",c:"#A8C4B8"},{l:"Beautiful",c:"#E8B4C8"},
  {l:"Empowered",c:"#8E3A4C"},{l:"Indulgent",c:"#6B2E4A"},{l:"Refreshed",c:"#5FD4D4"},
];

const ARCHETYPE_FAMILIES=[
  {v:"hero",l:"Hero",d:"Drive change, prove worth, master a craft",color:"#E5667A",font:"'Bebas Neue', sans-serif",weight:"bold"},
  {v:"caregiver",l:"Caregiver",d:"Protect, nurture, serve others",color:"#3DB88A",font:"'Fraunces', serif",weight:"normal"},
  {v:"explorer",l:"Explorer",d:"Discover, innovate, push boundaries",color:"#7C6AF5",font:"'DM Sans', sans-serif",weight:"600"},
  {v:"creator",l:"Creator",d:"Express, refine, craft beauty",color:"#C9A84C",font:"'Playfair Display', serif",weight:"normal"},
];
const ARCHETYPES={
  hero:[
    {v:"hero_hero",l:"The Hero",d:"Triumphant, bold, performance-driven. Like Nike."},
    {v:"hero_outlaw",l:"The Outlaw",d:"Rebellious, disruptive, breaks the rules. Like Harley-Davidson."},
    {v:"hero_magician",l:"The Magician",d:"Transformative, visionary, makes dreams real. Like Disney."},
  ],
  caregiver:[
    {v:"care_caregiver",l:"The Caregiver",d:"Warm, generous, devoted to others. Like Johnson & Johnson."},
    {v:"care_ruler",l:"The Host",d:"Refined, authoritative, sets the standard. Like Rolex or Louis Vuitton."},
    {v:"care_everyman",l:"The Trusted Friend",d:"Honest, approachable, real. Like IKEA."},
  ],
  explorer:[
    {v:"exp_explorer",l:"The Explorer",d:"Free-spirited, adventurous, seeking. Like Patagonia."},
    {v:"exp_sage",l:"The Expert",d:"Knowledgeable, credible, authoritative. Like The Economist."},
    {v:"exp_jester",l:"The Cool Peer",d:"Playful, casual, in on the joke. Like Old Spice."},
  ],
  creator:[
    {v:"crt_creator",l:"The Creator",d:"Artistic, expressive, original. Like Apple or Lego."},
    {v:"crt_lover",l:"The Lover",d:"Sensual, intimate, beautiful. Like Chanel or Aesop."},
    {v:"crt_innocent",l:"The Innocent",d:"Pure, optimistic, simple. Like Dove or Coca-Cola."},
  ],
};

const MUSIC=[
  {v:"acoustic",e:"🎸",l:"Warm Acoustic",d:"Intimate, soulful, human"},
  {v:"arabic",e:"🎵",l:"Arabic Contemporary",d:"Cultural, current, local"},
  {v:"pop",e:"✨",l:"Upbeat Pop",d:"Energetic, positive, youthful"},
  {v:"cinematic",e:"🎬",l:"Cinematic",d:"Elevated, dramatic, premium"},
  {v:"lofi",e:"🌙",l:"Lo-fi Minimal",d:"Calm, clean, thoughtful"},
  {v:"energy",e:"⚡",l:"High Energy",d:"Bold, fast, attention-grabbing"},
];

const RESTRICTIONS=[
  "Human faces","Alcohol","Pork / Non-halal","Revealing clothing",
  "Religious imagery / Quranic verses","Music in video content",
  "Christmas / Easter","Valentine's Day","Competitor brands","Young children",
  "English-only content","AI-looking visuals","Overly polished / stock feel",
];

const OCCASIONS=["Ramadan","Eid Al-Fitr","Eid Al-Adha","Saudi National Day","Founding Day","Mother's Day","Back to School","Summer / Seasonal","Seasonal Offers"];

const LIFECYCLE=[
  {v:"launch",l:"Just Launched",d:"0–6 months. Building first audience."},
  {v:"growth",l:"Growing",d:"6 months–2 years. Finding what works."},
  {v:"established",l:"Established",d:"2–5 years. Known in your category."},
  {v:"mature",l:"Mature",d:"5+ years. Strong local presence."},
  {v:"legacy",l:"Legacy",d:"Generational. Heritage brand."},
];

const GOALS=[
  {v:"orders",e:"📦",l:"Get More Orders",d:"Drive direct sales and conversions"},
  {v:"awareness",e:"👁",l:"Build Recognition",d:"Make more people know who we are"},
  {v:"launch",e:"🚀",l:"Launch Something New",d:"Introduce a product or location"},
  {v:"community",e:"❤️",l:"Grow My Following",d:"Build an audience and community"},
  {v:"trust",e:"🏆",l:"Build Trust",d:"Establish authority in our category"},
];
const PROBLEMS=["Too generic","Didn't match our brand","Too expensive","Inconsistent quality","Took too long","Low engagement","Wrong audience","Never tried before"];
const VISIONS=[
  {v:"customers",e:"🚪",l:"Doors Always Open",d:"More customers every day"},
  {v:"recognition",e:"⭐",l:"Instantly Recognizable",d:"Known by look alone"},
  {v:"community",e:"❤️",l:"A Real Community",d:"Followers who care and return"},
  {v:"premium",e:"💎",l:"Undeniably Premium",d:"Commands respect and price"},
];
const PRICING=[
  {v:"budget",l:"Corner Bakery",d:"Everyday, accessible — under SAR 30",t:"Budget"},
  {v:"mid",l:"Café Specialty",d:"Quality-conscious — SAR 30–100",t:"Mid range"},
  {v:"premium",l:"Boutique Brand",d:"Selective purchase — SAR 100–500",t:"Premium"},
  {v:"luxury",l:"Luxury Experience",d:"Investment piece — SAR 500+",t:"Luxury"},
];

const QMETA={
  1:{t:"Let's start with your name.",s:"Tell us who you are in your own words.",ch:1},
  2:{t:"Show us what you make.",s:"One hero product. The one your brand is built around.",ch:1},
  3:{t:"Which sector best describes you?",s:"This decides which of the 88 production chains we open for you first.",ch:1},
  4:{t:"Where does your audience find you?",s:"We meet your customers where they already are. Public posts only — never DMs.",ch:1},
  5:{t:"Where does your brand sit?",s:"Move each slider. Watch your brand take shape on the right.",ch:2},
  6:{t:"Which brands do you wish you looked like?",s:"Pick three. Any sector. Any size.",ch:2},
  7:{t:"Picture your best customer's Friday evening.",s:"One scene. The one that feels most like them.",ch:2},
  8:{t:"Where does your product sit in the market?",s:"Honest positioning creates better content than aspirational.",ch:2},
  9:{t:"How do you want people to feel?",s:"Pick three emotions. Watch your brand's color emerge.",ch:2},
  10:{t:"If your brand was a person, who would they be?",s:"This single answer routes hundreds of creative decisions.",ch:3},
  11:{t:"If your brand had a soundtrack, what would it sound like?",s:"Pick the one that feels right.",ch:3},
  12:{t:"What should we never show?",s:"Your rules become hard policy across every chain.",ch:3},
  13:{t:"What language do you speak to your customers?",s:"This controls Arabic and English output across every chain.",ch:3},
  14:{t:"Rank the moments that matter most.",s:"Tap in order — #1 first, then #2, then #3.",ch:3},
  15:{t:"Who do you respect in your space?",s:"Name 2 brands. Not who you compete with — who you admire.",ch:4},
  16:{t:"What's the main thing content needs to do?",s:"One goal. The most important one right now.",ch:4},
  17:{t:"Has content ever not worked for you?",s:"What felt wrong is more useful than what felt right.",ch:4},
  18:{t:"Tell us your founding story.",s:"When, where, and why you started. 2–3 sentences.",ch:4},
  19:{t:"Share everything you already have.",s:"The more we start with, the less we have to invent.",ch:5},
  20:{t:"What does success look like in 12 months?",s:"Your answer becomes the memory seed the system optimises toward.",ch:5},
};

function getChapter(q){return CHAPTERS.find(c=>c.id===QMETA[q].ch);}
function isChapterStart(q){return q===1||QMETA[q].ch!==QMETA[q-1]?.ch;}

function familyFill(a){
  const A = !!(a.name_en && a.name_meaning && a.lifecycle && (a.scale_minmax!==undefined) && a.brand_refs?.length && a.archetype && a.music);
  const B = !!(a.restrictions?.length && a.language);
  const C = !!(a.hero_upload && a.pricing && a.respected);
  const D = !!(a.goal && a.vision);
  const E = !!(a.sector && a.platforms?.length && a.lifestyle && a.emotions?.length);
  return {A,B,C,D,E};
}

function calcConf(a){
  const keys=["name_meaning","hero_why","founding_story","social","scale_custom","brand_files","cust_desc","price_nums","cust_quote","caption_ex","music_link","custom_restriction","tagline","custom_occasion","respected_why","metric","vision_text","anything"];
  let count = keys.filter(k=>a[k]&&(typeof a[k]==="string"?a[k].trim():a[k])).length;
  // Multi-upload bundle counts as one "boost" key, plus a bonus for >3 files
  if(a.brand_assets_bundle?.length) count++;
  if(a.brand_assets_bundle?.length >= 3) count++;
  return Math.round(count/(keys.length+2)*100);
}

// Blend emotion colors into one accent
function blendEmotionColor(emotions=[]){
  if(!emotions.length) return null;
  const colors = emotions.map(l => EMOTIONS.find(e=>e.l===l)?.c).filter(Boolean);
  if(!colors.length) return null;
  // Average RGB
  const rgb = colors.map(h=>{
    const x = h.replace("#","");
    return [parseInt(x.slice(0,2),16),parseInt(x.slice(2,4),16),parseInt(x.slice(4,6),16)];
  });
  const avg = [0,1,2].map(i=>Math.round(rgb.reduce((s,c)=>s+c[i],0)/rgb.length));
  return `rgb(${avg.join(",")})`;
}

// Milestones — copy that lands
const MILESTONES = [
  {at:25,msg:"We're starting to know you."},
  {at:50,msg:"We could brief a designer with this."},
  {at:75,msg:"This is more than your last agency had."},
  {at:90,msg:"Your competitors couldn't fake this if they tried."},
];

// ─── i18n: STRINGS in two languages ─────────────────────────────
// Arabic written in voice of Hassan — humble Saudi creative director.
// Plainspoken, warm, not robotic MSA. Uses "خل", "وش", colloquial endings.
const STRINGS = {
  en: {
    setup_label:"OGz AI · BRAND SETUP",
    welcome_h1a:"Let's build your",
    welcome_h1b:"Brand DNA.",
    welcome_p1:"20 questions. 8 minutes. Watch your brand DNA assemble as you answer.",
    welcome_p2:"Everything you share shapes every piece of content\nacross 88 production chains, forever.",
    welcome_btn:"BEGIN →",
    welcome_footer:"The more you tell us, the smarter the system gets.",
    welcome_lang_q:"Which language do you prefer?",
    let_go:"LET'S GO →",
    chapter_intros:["", "Who you are","Aesthetic & mood","How you communicate","Market & positioning","Where you're going"],
    branddna_family:"BRANDDNA · FAMILY",
    chapters:["","Foundation","The Feel","The Voice","The Business","The Vision"],
    btn_continue:"CONTINUE →",
    btn_back:"← BACK",
    btn_build:"BUILD BRAND DNA ✓",
    brand_dna:"BRAND DNA",
    pairs:"pairs",
    strength:"STRENGTH",
    locked:"● LOCKED",
    partial:"○ partial",
    status:[
      "Awaiting first sequence...",
      "Building strand A...",
      "Family A taking shape...",
      "Voice patterns emerging...",
      "Strand integrity strong...",
      "DNA stable. Ready for production.",
      "Almost complete. Final pairs locking in.",
      "Sequence complete. This brand exists nowhere else.",
    ],
    families:[
      {k:"A",l:"Identity"},{k:"E",l:"Context"},{k:"B",l:"Policy"},
      {k:"C",l:"Evidence"},{k:"D",l:"Memory"},
    ],
    milestones:[
      "We're starting to know you.",
      "We could brief a designer with this.",
      "This is more than your last agency had.",
      "Your competitors couldn't fake this if they tried.",
    ],
    milestone_label:"● MILESTONE",
    done_label:"✓ BRAND DNA V2 COMPLETE",
    done_strength_lbl:"BRAND DNA STRENGTH",
    done_schema_lbl:"SCHEMA · BRANDDNA V2",
    done_copy_btn:"COPY BRAND DNA V2 JSON",
    done_copied:"✓ COPIED — READY TO HAND TO WEIBLOCK",
    done_restart:"START OVER",
    rec_step:"STEP",
    rec_of:"OF",
    rec_change_family:"change family",
    optional:"OPTIONAL — YOUR SPACE",
    selected_of:"selected",
    ranked_of:"ranked",
    sub_emotions_blend:"these blend into your brand's color",
    sub_sliders:"{(STRINGS[lang]||STRINGS.en).sub_sliders}",
    sub_live_post:"↓ A POST IN YOUR BRAND, RIGHT NOW",
    live:"● LIVE",
    upload_add:"Add files",
    upload_drop:"or drop them here",
    upload_more:"Add more",
    upload_max:"10 files max",
    upload_file:"file",
    upload_files:"files",
  },
  ar: {
    setup_label:"OGz AI · إعداد العلامة",
    welcome_h1a:"خل نبني",
    welcome_h1b:"هوية علامتك.",
    welcome_p1:"٢٠ سؤال. ٨ دقايق. شوف هوية علامتك تتركّب وأنت تجاوب.",
    welcome_p2:"كل شي تشاركه معنا يصير جزء من كل محتوى\nنسوّيه عبر ٨٨ سلسلة إنتاج، للأبد.",
    welcome_btn:"يلا نبدأ ←",
    welcome_footer:"كل ما تعطينا تفاصيل أكثر، صار النظام أذكى.",
    welcome_lang_q:"وش اللغة المريحة لك؟",
    let_go:"يلا ←",
    chapter_intros:["", "مين أنت","الإحساس والمزاج","كيف تتكلم","السوق والمنافسة","وين رايح"],
    branddna_family:"هوية العلامة · عائلة",
    chapters:["","الأساس","الإحساس","الصوت","السوق","الرؤية"],
    btn_continue:"كمل ←",
    btn_back:"رجوع →",
    btn_build:"ابنِ هوية العلامة ✓",
    brand_dna:"هوية العلامة",
    pairs:"ربط",
    strength:"القوة",
    locked:"● ثابت",
    partial:"○ ناقص",
    status:[
      "بانتظار أول سؤال...",
      "نبدأ نركّب أول خيط...",
      "العائلة الأولى تتشكّل...",
      "الصوت بدا يبين...",
      "الهيكل صار قوي...",
      "الهوية ثابتة. جاهزين للإنتاج.",
      "قربنا نخلّص. آخر الروابط تتثبّت.",
      "خلصنا. هالعلامة ما تشبه أحد ثاني.",
    ],
    families:[
      {k:"A",l:"الهوية"},{k:"E",l:"السياق"},{k:"B",l:"السياسة"},
      {k:"C",l:"الدليل"},{k:"D",l:"الذاكرة"},
    ],
    milestones:[
      "بدينا نعرفك.",
      "نقدر نوجّه مصمم بهذي المعلومات.",
      "هذا أكثر مما عند أي وكالة شغلت معاهم.",
      "منافسينك ما يقدرون يقلّدون هذا حتى لو حاولوا.",
    ],
    milestone_label:"● إنجاز",
    done_label:"✓ هوية العلامة جاهزة",
    done_strength_lbl:"قوة هوية العلامة",
    done_schema_lbl:"الهيكل · BRANDDNA V2",
    done_copy_btn:"نسخ ملف الهوية JSON",
    done_copied:"✓ تم النسخ — جاهز ترسله لـ Weiblock",
    done_restart:"إعادة البداية",
    rec_step:"خطوة",
    rec_of:"من",
    rec_change_family:"غيّر العائلة",
    optional:"اختياري — هذي مساحتك",
    selected_of:"مختار",
    ranked_of:"مرتّب",
    sub_emotions_blend:"هذي تختلط مع لون علامتك",
    sub_sliders:"حرّك الأشرطة. المعاينة تتغيّر معاك.",
    sub_live_post:"↓ منشور بهوية علامتك، الحين",
    live:"● مباشر",
    upload_add:"أضف ملفات",
    upload_drop:"أو اسحبها هنا",
    upload_more:"أضف أكثر",
    upload_max:"الحد الأقصى ١٠ ملفات",
    upload_file:"ملف",
    upload_files:"ملفات",
  },
};

// QMETA — bilingual question metadata
const QMETA_BI = {
  1:{en:{t:"Let's start with your name.",s:"Tell us who you are in your own words."},
     ar:{t:"خلينا نبدا بالاسم.",s:"عرّفنا على نفسك، بكلامك."},ch:1},
  2:{en:{t:"Show us what you make.",s:"One hero product. The one your brand is built around."},
     ar:{t:"ورّنا وش تسوّي.",s:"منتج واحد بطل. اللي علامتك مبنية حوله."},ch:1},
  3:{en:{t:"Which sector best describes you?",s:"This decides which of the 88 production chains we open for you first."},
     ar:{t:"في أي مجال أنت؟",s:"هذا اللي يحدد أي سلاسل إنتاج (من ٨٨) نفتحلك أول."},ch:1},
  4:{en:{t:"Where does your audience find you?",s:"We meet your customers where they already are. Public posts only — never DMs."},
     ar:{t:"وين عملاؤك يلاقونك؟",s:"نوصلهم في المكان اللي هم فيه. منشورات عامة بس — ما نلمس الرسايل."},ch:1},
  5:{en:{t:"Where does your brand sit?",s:"Move each slider. Watch your brand take shape on the right."},
     ar:{t:"وين موقع علامتك؟",s:"حرّك كل شريط. شوف علامتك تتشكّل."},ch:2},
  6:{en:{t:"Which brands do you wish you looked like?",s:"Pick three. Any sector. Any size."},
     ar:{t:"أي علامات تتمنى تشبهها؟",s:"اختر ثلاث. أي مجال. أي حجم."},ch:2},
  7:{en:{t:"Picture your best customer's Friday evening.",s:"One scene. The one that feels most like them."},
     ar:{t:"تخيّل عميلك المفضّل ليلة الجمعة.",s:"مشهد واحد. اللي يشبهه أكثر."},ch:2},
  8:{en:{t:"Where does your product sit in the market?",s:"Honest positioning creates better content than aspirational."},
     ar:{t:"وين منتجك في السوق؟",s:"الصراحة في الموقع تطلع محتوى أحسن من التمني."},ch:2},
  9:{en:{t:"How do you want people to feel?",s:"Pick three emotions. Watch your brand's color emerge."},
     ar:{t:"كيف تبي الناس تحس؟",s:"اختر ثلاث مشاعر. شوف لون علامتك يظهر."},ch:2},
  10:{en:{t:"If your brand was a person, who would they be?",s:"This single answer routes hundreds of creative decisions."},
      ar:{t:"لو علامتك شخص، مين بيكون؟",s:"هذي الإجابة لحالها توجّه مئات القرارات الإبداعية."},ch:3},
  11:{en:{t:"If your brand had a soundtrack, what would it sound like?",s:"Pick the one that feels right."},
      ar:{t:"لو لعلامتك موسيقى، كيف تكون؟",s:"اختر اللي يحسّك."},ch:3},
  12:{en:{t:"What should we never show?",s:"Your rules become hard policy across every chain."},
      ar:{t:"وش الشي اللي ما نوريه أبداً؟",s:"قواعدك تصير سياسة ثابتة في كل سلسلة."},ch:3},
  13:{en:{t:"What language do you speak to your customers?",s:"This controls Arabic and English output across every chain."},
      ar:{t:"بأي لغة تكلّم عملاءك؟",s:"هذا يتحكّم بإخراج العربي والإنجليزي في كل سلسلة."},ch:3},
  14:{en:{t:"Rank the moments that matter most.",s:"Tap in order — #1 first, then #2, then #3."},
      ar:{t:"رتّب المناسبات الأهم.",s:"اضغط بالترتيب — ١، ثم ٢، ثم ٣."},ch:3},
  15:{en:{t:"Who do you respect in your space?",s:"Name 2 brands. Not who you compete with — who you admire."},
      ar:{t:"مين تحترم في مجالك؟",s:"اذكر علامتين. مش منافسين — اللي تعجبك."},ch:4},
  16:{en:{t:"What's the main thing content needs to do?",s:"One goal. The most important one right now."},
      ar:{t:"وش أهم شي تبي المحتوى يسوّيه؟",s:"هدف واحد. الأهم الحين."},ch:4},
  17:{en:{t:"Has content ever not worked for you?",s:"What felt wrong is more useful than what felt right."},
      ar:{t:"هل صار لك محتوى ما اشتغل؟",s:"اللي حسسك بغلط أنفع من اللي حسسك بصح."},ch:4},
  18:{en:{t:"Tell us your founding story.",s:"When, where, and why you started. 2–3 sentences."},
      ar:{t:"احكِ لنا قصة البداية.",s:"متى، وين، وليش بديت. جملتين أو ثلاث."},ch:4},
  19:{en:{t:"Share everything you already have.",s:"The more we start with, the less we have to invent."},
      ar:{t:"شاركنا اللي عندك بالأصل.",s:"كل ما نبدا بأكثر، نخترع أقل."},ch:5},
  20:{en:{t:"What does success look like in 12 months?",s:"Your answer becomes the memory seed the system optimises toward."},
      ar:{t:"كيف يبين النجاح بعد سنة؟",s:"إجابتك تصير بذرة الذاكرة اللي النظام يشتغل عليها."},ch:5},
};

// Translation table for the data constants — only fields users see
const TR = {
  sectors:{
    fnb:{en:{l:"Food & Beverage",d:"Restaurants, cafés, FMCG, sweets"},
         ar:{l:"المطاعم والمشروبات",d:"مطاعم، كافيهات، منتجات، حلويات"}},
    beauty:{en:{l:"Beauty & Personal Care",d:"Skincare, perfume, cosmetics, salons"},
            ar:{l:"الجمال والعناية",d:"عناية بالبشرة، عطور، مكياج، صالونات"}},
    retail:{en:{l:"Retail & Fashion",d:"Apparel, jewellery, accessories, home"},
            ar:{l:"التجزئة والأزياء",d:"ملابس، مجوهرات، إكسسوارات، البيت"}},
    other:{en:{l:"Something Else",d:"We'll map you to the closest sector"},
           ar:{l:"شي ثاني",d:"بنحطك على أقرب مجال"}},
  },
  lifecycle:{
    launch:{en:{l:"Just Launched",d:"0–6 months. Building first audience."},
            ar:{l:"بديت لتو",d:"٠–٦ شهور. تبني أول جمهور."}},
    growth:{en:{l:"Growing",d:"6 months–2 years. Finding what works."},
            ar:{l:"في نمو",d:"٦ شهور–سنتين. تكتشف اللي يشتغل."}},
    established:{en:{l:"Established",d:"2–5 years. Known in your category."},
                 ar:{l:"ثابت",d:"٢–٥ سنوات. معروف في مجالك."}},
    mature:{en:{l:"Mature",d:"5+ years. Strong local presence."},
            ar:{l:"ناضج",d:"٥ سنوات+. حضور محلي قوي."}},
    legacy:{en:{l:"Legacy",d:"Generational. Heritage brand."},
            ar:{l:"إرث",d:"عبر الأجيال. علامة تراثية."}},
  },
  lifestyles:{
    family_home:{en:{l:"Family Home Evening",d:"Cooking, gathering, warmth"},
                 ar:{l:"مسا البيت مع الأهل",d:"طبخ، اجتماع، دفء"}},
    coffee_solo:{en:{l:"Coffee Shop Solo",d:"Working, discovering, scrolling"},
                 ar:{l:"كافيه لحاله",d:"شغل، اكتشاف، تصفّح"}},
    mall_friends:{en:{l:"Mall with Friends",d:"Shopping, socialising, trending"},
                  ar:{l:"المول مع الأصحاب",d:"تسوّق، جلسة، ترند"}},
    gym:{en:{l:"Active & Health-Conscious",d:"Gym, clean eating, self-care"},
         ar:{l:"رياضي ومهتم بصحته",d:"جيم، أكل نظيف، عناية"}},
    gathering:{en:{l:"Home Gathering",d:"Hosting, entertaining, sharing"},
               ar:{l:"عزيمة بالبيت",d:"استضافة، ضيافة، مشاركة"}},
    outdoor:{en:{l:"Outdoor & Adventure",d:"Travel, exploration, freedom"},
             ar:{l:"بر ومغامرة",d:"سفر، استكشاف، حرية"}},
  },
  pricing:{
    budget:{en:{l:"Corner Bakery",d:"Everyday, accessible — under SAR 30",t:"Budget"},
            ar:{l:"مخبز الحارة",d:"يومي، في المتناول — أقل من ٣٠ ريال",t:"اقتصادي"}},
    mid:{en:{l:"Café Specialty",d:"Quality-conscious — SAR 30–100",t:"Mid range"},
         ar:{l:"كافيه مختص",d:"جودة عالية — ٣٠–١٠٠ ريال",t:"متوسط"}},
    premium:{en:{l:"Boutique Brand",d:"Selective purchase — SAR 100–500",t:"Premium"},
             ar:{l:"بوتيك",d:"شراء انتقائي — ١٠٠–٥٠٠ ريال",t:"بريميوم"}},
    luxury:{en:{l:"Luxury Experience",d:"Investment piece — SAR 500+",t:"Luxury"},
            ar:{l:"فاخر",d:"استثمار — ٥٠٠ ريال+",t:"فخامة"}},
  },
  goals:{
    orders:{en:{l:"Get More Orders",d:"Drive direct sales and conversions"},
            ar:{l:"زيد الطلبات",d:"مبيعات مباشرة وتحويلات"}},
    awareness:{en:{l:"Build Recognition",d:"Make more people know who we are"},
               ar:{l:"خلّ الناس تعرفك",d:"وعي بالعلامة"}},
    launch:{en:{l:"Launch Something New",d:"Introduce a product or location"},
            ar:{l:"إطلاق جديد",d:"منتج أو فرع جديد"}},
    community:{en:{l:"Grow My Following",d:"Build an audience and community"},
               ar:{l:"كبّر متابعينك",d:"جمهور ومجتمع حقيقي"}},
    trust:{en:{l:"Build Trust",d:"Establish authority in our category"},
           ar:{l:"اكسب الثقة",d:"كن المرجع في مجالك"}},
  },
  visions:{
    customers:{en:{l:"Doors Always Open",d:"More customers every day"},
               ar:{l:"الأبواب مفتوحة دايم",d:"عملاء أكثر كل يوم"}},
    recognition:{en:{l:"Instantly Recognizable",d:"Known by look alone"},
                 ar:{l:"معروف من شكله",d:"يميّزونك بالنظرة"}},
    community:{en:{l:"A Real Community",d:"Followers who care and return"},
               ar:{l:"مجتمع حقيقي",d:"متابعين يهتمون ويرجعون"}},
    premium:{en:{l:"Undeniably Premium",d:"Commands respect and price"},
             ar:{l:"فخامة ما تتنكر",d:"احترام وسعر يستحق"}},
  },
  music:{
    acoustic:{en:{l:"Warm Acoustic",d:"Intimate, soulful, human"},
              ar:{l:"أكوستيك دافئ",d:"حميمي، روح، إنساني"}},
    arabic:{en:{l:"Arabic Contemporary",d:"Cultural, current, local"},
            ar:{l:"عربي معاصر",d:"ثقافي، حالي، محلي"}},
    pop:{en:{l:"Upbeat Pop",d:"Energetic, positive, youthful"},
         ar:{l:"بوب حماسي",d:"طاقة، إيجابي، شبابي"}},
    cinematic:{en:{l:"Cinematic",d:"Elevated, dramatic, premium"},
               ar:{l:"سينمائي",d:"راقي، درامي، فخم"}},
    lofi:{en:{l:"Lo-fi Minimal",d:"Calm, clean, thoughtful"},
          ar:{l:"لوفاي بسيط",d:"هادي، نظيف، عميق"}},
    energy:{en:{l:"High Energy",d:"Bold, fast, attention-grabbing"},
            ar:{l:"طاقة عالية",d:"جريء، سريع، يلفت النظر"}},
  },
  archetype_families:{
    hero:{en:{l:"Hero",d:"Drive change, prove worth, master a craft"},
          ar:{l:"البطل",d:"قيادة التغيير، إثبات الذات، إتقان الحرفة"}},
    caregiver:{en:{l:"Caregiver",d:"Protect, nurture, serve others"},
               ar:{l:"الراعي",d:"حماية، رعاية، خدمة"}},
    explorer:{en:{l:"Explorer",d:"Discover, innovate, push boundaries"},
              ar:{l:"المستكشف",d:"اكتشاف، ابتكار، توسيع الحدود"}},
    creator:{en:{l:"Creator",d:"Express, refine, craft beauty"},
             ar:{l:"المبدع",d:"تعبير، صقل، جمال"}},
  },
  archetypes:{
    hero_hero:{en:{l:"The Hero",d:"Triumphant, bold, performance-driven. Like Nike."},
               ar:{l:"البطل",d:"منتصر، جريء، أداء. مثل نايكي."}},
    hero_outlaw:{en:{l:"The Outlaw",d:"Rebellious, disruptive, breaks the rules. Like Harley-Davidson."},
                 ar:{l:"الخارج عن القانون",d:"متمرّد، يكسر القواعد. مثل هارلي."}},
    hero_magician:{en:{l:"The Magician",d:"Transformative, visionary, makes dreams real. Like Disney."},
                   ar:{l:"الساحر",d:"محوّل، صاحب رؤية، يحقّق الأحلام. مثل ديزني."}},
    care_caregiver:{en:{l:"The Caregiver",d:"Warm, generous, devoted to others. Like Johnson & Johnson."},
                    ar:{l:"الراعي",d:"دافئ، كريم، مخلص للآخرين. مثل جونسون."}},
    care_ruler:{en:{l:"The Host",d:"Refined, authoritative, sets the standard. Like Rolex or Louis Vuitton."},
                ar:{l:"المضيف",d:"راقي، يحدّد المعيار. مثل رولكس أو لوي فيتون."}},
    care_everyman:{en:{l:"The Trusted Friend",d:"Honest, approachable, real. Like IKEA."},
                   ar:{l:"الصديق الموثوق",d:"صادق، قريب، حقيقي. مثل ايكيا."}},
    exp_explorer:{en:{l:"The Explorer",d:"Free-spirited, adventurous, seeking. Like Patagonia."},
                  ar:{l:"المستكشف",d:"حر، مغامر، باحث. مثل باتاغونيا."}},
    exp_sage:{en:{l:"The Expert",d:"Knowledgeable, credible, authoritative. Like The Economist."},
              ar:{l:"الخبير",d:"عارف، موثوق، مرجع. مثل ذا إيكونوميست."}},
    exp_jester:{en:{l:"The Cool Peer",d:"Playful, casual, in on the joke. Like Old Spice."},
                ar:{l:"الند الكوول",d:"مرح، سهل، يفهم النكتة. مثل أولد سبايس."}},
    crt_creator:{en:{l:"The Creator",d:"Artistic, expressive, original. Like Apple or Lego."},
                 ar:{l:"المبدع",d:"فنان، معبّر، أصلي. مثل آبل أو ليجو."}},
    crt_lover:{en:{l:"The Lover",d:"Sensual, intimate, beautiful. Like Chanel or Aesop."},
               ar:{l:"العاشق",d:"حسّي، حميمي، جميل. مثل شانيل أو إيسوب."}},
    crt_innocent:{en:{l:"The Innocent",d:"Pure, optimistic, simple. Like Dove or Coca-Cola."},
                  ar:{l:"البريء",d:"نقي، متفائل، بسيط. مثل دوف أو كوكاكولا."}},
  },
  emotions:{
    "Inspired":"ملهم","Reassured":"مطمئن","Excited":"متحمس","Proud":"فخور",
    "Curious":"فضولي","Nostalgic":"حنين","Impressed":"معجب","Included":"منضم",
    "Understood":"مفهوم","Motivated":"مندفع","Confident":"واثق","Sophisticated":"راقي",
    "Energized":"طاقة","Calm":"هادي","Beautiful":"جميل","Empowered":"قوي",
    "Indulgent":"تدليل","Refreshed":"منتعش",
  },
  restrictions:{
    "Human faces":"وجوه بشر",
    "Alcohol":"كحول",
    "Pork / Non-halal":"خنزير / غير حلال",
    "Revealing clothing":"ملابس مكشوفة",
    "Religious imagery / Quranic verses":"رموز دينية / آيات قرآنية",
    "Music in video content":"موسيقى في الفيديو",
    "Christmas / Easter":"كريسماس / إيستر",
    "Valentine's Day":"عيد الحب",
    "Competitor brands":"علامات المنافسين",
    "Young children":"أطفال صغار",
    "English-only content":"محتوى إنجليزي فقط",
    "AI-looking visuals":"صور تبين أنها AI",
    "Overly polished / stock feel":"مبالغ بالتنميق / حس ستوك",
  },
  problems:{
    "Too generic":"عام جداً",
    "Didn't match our brand":"ما يناسب علامتنا",
    "Too expensive":"غالي",
    "Inconsistent quality":"الجودة متذبذبة",
    "Took too long":"أخذ وقت طويل",
    "Low engagement":"تفاعل ضعيف",
    "Wrong audience":"جمهور خطأ",
    "Never tried before":"ما جربت قبل",
  },
  occasions:{
    "Ramadan":"رمضان",
    "Eid Al-Fitr":"عيد الفطر",
    "Eid Al-Adha":"عيد الأضحى",
    "Saudi National Day":"اليوم الوطني",
    "Founding Day":"يوم التأسيس",
    "Mother's Day":"عيد الأم",
    "Back to School":"العودة للمدارس",
    "Summer / Seasonal":"الصيف / موسمي",
    "Seasonal Offers":"عروض موسمية",
  },
  platforms:{
    "Instagram":"انستقرام","Snapchat":"سناب شات","TikTok":"تيك توك",
    "WhatsApp":"واتساب","Online store":"متجر إلكتروني","Physical store":"محل",
    "YouTube":"يوتيوب","X (Twitter)":"إكس (تويتر)",
  },
  languages:{
    "Arabic only":"عربي فقط",
    "English only":"إنجليزي فقط",
    "Bilingual — Arabic first":"ثنائي — العربي أول",
    "Bilingual — English first":"ثنائي — الإنجليزي أول",
  },
  brand_age_labels:{
    "Just started":"بديت",
    "1–3 years":"١–٣ سنوات",
    "Established brand":"علامة ثابتة",
    "Legacy brand":"علامة تراثية",
  },
  // Hero product copy per sector × language
  hero_product:{
    fnb:{en:{label:"Show us your hero dish",hint:"The one customers come back for"},
         ar:{label:"ورّنا طبقك البطل",hint:"اللي العملاء يرجعون عشانه"}},
    beauty:{en:{label:"Show us your hero product",hint:"The one your customers can't run out of"},
            ar:{label:"ورّنا منتجك البطل",hint:"اللي عملاؤك ما يقدرون يخلصونه"}},
    retail:{en:{label:"Show us your hero piece",hint:"Your bestseller, your signature, your icon"},
            ar:{label:"ورّنا قطعتك البطلة",hint:"الأكثر مبيعاً، توقيعك، أيقونتك"}},
    other:{en:{label:"Show us your hero product",hint:"The one customers come back for"},
           ar:{label:"ورّنا منتجك البطل",hint:"اللي العملاء يرجعون عشانه"}},
  },
  hero_why:{
    fnb:{en:"What makes this dish the one people order again?",
         ar:"وش يخلي هذا الطبق هو اللي الناس تعيد طلبه؟"},
    beauty:{en:"What makes this product the one people repurchase?",
            ar:"وش يخلي هذا المنتج هو اللي الناس تعيد شراءه؟"},
    retail:{en:"What makes this piece the one people tell friends about?",
            ar:"وش يخلي هالقطعة هي اللي الناس تكلّم أصحابها عنها؟"},
    other:{en:"What makes this the one customers return for?",
           ar:"وش يخلي هذا هو اللي العملاء يرجعون عشانه؟"},
  },
  // RecBadge copy
  recs:{
    name_meaning:{en:"Story depth — Family A",ar:"عمق القصة — عائلة A"},
    hero_anchor:{en:"Anchors every product chain",ar:"يثبّت كل سلسلة منتجات"},
    lifecycle:{en:"Lifecycle stage — drives archetype × lifecycle × intent routing",
               ar:"المرحلة — توجّه ربط النمط × المرحلة × النية"},
    public_only:{en:"Public handles only — never DMs or posts on your behalf",
                 ar:"حسابات عامة بس — ما نلمس الرسايل ولا ننشر باسمك"},
    one_recommend:{en:"The single line a customer would use to recommend you",
                   ar:"السطر الواحد اللي عميل يستخدمه عشان يرشّحك"},
    pricing_real:{en:"Real numbers anchor Family C evidence",
                  ar:"الأرقام الحقيقية تثبّت دليل عائلة C"},
    customer_quote:{en:"A real customer quote beats any creative brief",
                    ar:"اقتباس من عميل حقيقي يتفوّق على أي بريف إبداعي"},
    on_brand_example:{en:"A real on-brand example calibrates the captions chain",
                      ar:"مثال حقيقي بهوية علامتك يضبط سلسلة الكابشن"},
    actual_track:{en:"An actual track sets video chain tone better than a genre",
                  ar:"أغنية حقيقية تحدّد طابع الفيديو أحسن من النوع"},
    custom_restriction:{en:"Words or colors you'd never use — enforced on every chain",
                        ar:"كلمات أو ألوان ما تستخدمها أبداً — تُطبّق في كل سلسلة"},
    tagline_verbatim:{en:"Your tagline gets used verbatim by the captions chain",
                      ar:"شعارك يُستخدم بالضبط في سلسلة الكابشن"},
    local_occasion:{en:"A local occasion the standard calendar doesn't know",
                    ar:"مناسبة محلية ما تعرفها التقويمات"},
    respected_why:{en:"Why you respect them — gives the system your real edge",
                   ar:"ليش تحترمهم — يعطي النظام ميزتك الحقيقية"},
    real_target:{en:"A real target makes recommendations measurable",
                 ar:"هدف حقيقي يخلي التوصيات قابلة للقياس"},
    sliders_missed:{en:"A word the sliders couldn't capture",
                    ar:"كلمة الأشرطة ما قدرت تلتقطها"},
    identity_files:{en:"Your actual identity files = maximum chain accuracy",
                    ar:"ملفات هويتك الحقيقية = أعلى دقة في السلاسل"},
    upload_max10:{en:"Logo, product photos, guidelines, past content, model references — up to 10 files",
                  ar:"شعار، صور منتجات، إرشادات، محتوى سابق، مراجع موديل — حتى ١٠ ملفات"},
  },
  // Placeholders
  ph:{
    name_en:{en:"Business name in English",ar:"اسم النشاط بالإنجليزي"},
    name_ar:{en:"اسم العمل بالعربي",ar:"اسم النشاط بالعربي"},
    name_meaning:{en:"What does the name mean? Is it named after someone, a place, or a feeling? Why did you choose it?",
                  ar:"وش يعني الاسم؟ على اسم شخص، مكان، إحساس؟ ليش اخترته؟"},
    social:{en:"@yourinstagram, @snapchat, yourwebsite.com",ar:"@انستقرامك، @سنابك، موقعك.com"},
    scale_custom:{en:"One word that defines your brand we didn't ask about...",
                  ar:"كلمة وحدة تعرّف علامتك ما سألناك عنها..."},
    cust_desc:{en:"What's the ONE thing your best customer says when they recommend you to a friend?",
               ar:"وش الشي الوحيد اللي عميلك المفضّل يقوله لما يرشّحك لصديق؟"},
    price_nums:{en:"Lowest item and highest item — e.g. SAR 15 → SAR 280",
                ar:"أقل سعر وأعلى سعر — مثلاً ١٥ ريال → ٢٨٠ ريال"},
    cust_quote:{en:"Has a customer ever said something that captured how you want people to feel?\n\nPaste a review, comment, or message here.",
                ar:"عميل قال شي عبّر عن الإحساس اللي تبيه؟\n\nالصق تقييم، تعليق، أو رسالة هنا."},
    caption_ex:{en:"Paste a caption or message you've written that felt perfectly on-brand.\n\nOr write one sentence the way you'd talk to a customer.",
                ar:"الصق كابشن أو رسالة كتبتها وحسيت إنها على هويتك ١٠٠٪.\n\nأو اكتب جملة بطريقة كلامك مع العميل."},
    music_link:{en:"Paste a YouTube or Spotify link...",
                ar:"الصق رابط يوتيوب أو سبوتيفاي..."},
    custom_restriction:{en:"Any specific words, colors, or imagery your brand never uses?\n\nExamples: 'never use red', 'never say cheap', 'no white backgrounds'",
                        ar:"كلمات أو ألوان أو صور علامتك ما تستخدمها أبداً؟\n\nمثال: 'ما نستخدم أحمر'، 'ما نقول رخيص'، 'بدون خلفيات بيضاء'"},
    tagline:{en:"Your tagline or slogan — e.g. طعم البيت",
             ar:"الشعار أو السلوغان — مثلاً طعم البيت"},
    custom_occasion:{en:"Any occasion specific to your city or community?",
                     ar:"أي مناسبة خاصة بمدينتك أو مجتمعك؟"},
    respected:{en:"Two brands you respect in your space",
               ar:"علامتين تحترمهم في مجالك"},
    respected_why:{en:"What do these brands do that you admire?\n\nAnd what's the gap you fill that they don't?",
                   ar:"وش يسوّون هالعلامات وتعجبك؟\n\nووش الفراغ اللي تملأه أنت بدلهم؟"},
    metric:{en:"A number you're working toward — orders, followers, revenue...",
            ar:"رقم تشتغل عليه — طلبات، متابعين، إيرادات..."},
    founding_story:{en:"When you started, where, and why. The honest version — what frustrated you, what you wanted to fix, what you couldn't find anywhere else.",
                    ar:"متى بديت، وين، وليش. النسخة الصادقة — وش ضايقك، وش تبي تصلحه، وش ما لقيته بأي مكان."},
    vision_text:{en:"In 12 months, what does your brand look like? Who knows it, where is it sold, how does it feel different?",
                 ar:"بعد سنة، كيف تبين علامتك؟ مين يعرفها، وين تنباع، كيف تختلف بالإحساس؟"},
    anything:{en:"Anything we haven't asked.\n\nA rule. A story. A fear. A dream.",
              ar:"أي شي ما سألناك عنه.\n\nقاعدة. قصة. خوف. حلم."},
  },
  // Lists / labels
  problems_intro:{en:"A negative example trains the system harder than a positive one. The more checkboxes here, the sharper the output.",
                  ar:"المثال السلبي يدرّب النظام أحسن من الإيجابي. كل ما خانة أكثر، كل ما الإخراج أحدّ."},
  story_intro:{en:"This story gets woven into every behind-the-scenes chain. Specific beats generic.",
               ar:"هذي القصة تتنسج في كل سلسلة كواليس. المحدد دايم أقوى من العام."},
  step_pick_family:{en:"PICK THE FAMILY",ar:"اختر العائلة"},
  step_archetypes:{en:"ARCHETYPES",ar:"الأنماط"},
  q14_local:{en:"A local occasion the standard calendar doesn't know",ar:"مناسبة محلية ما تعرفها التقويمات"},
  q9_count_hint:{en:"selected — these blend into your brand's color",ar:"مختار — تختلط مع لون علامتك"},
};

// Helper: get translated string from a TR entry
function tr(entry, lang, field="l"){
  return entry?.[lang]?.[field] ?? entry?.en?.[field] ?? "";
}

// ─── MultiUpZone: upload up to N files in one box ──────────────
function MultiUpZone({files=[], onChange, label, hint, accept="*", max=10, color, lang="en"}){
  const ref=useRef();
  const [drag,setDrag]=useState(false);
  const S=STRINGS[lang];
  const isRTL=lang==="ar";

  const addFiles = (fileList) => {
    const arr = Array.from(fileList).slice(0, max - files.length);
    const newFiles = arr.map(f => {
      const isImg = f.type?.startsWith("image/");
      return {
        name: f.name,
        size: f.size,
        type: f.type,
        preview: isImg ? URL.createObjectURL(f) : null,
      };
    });
    haptic(20);
    onChange([...files, ...newFiles]);
  };

  const removeFile = (idx) => {
    haptic();
    const next = files.filter((_,i)=>i!==idx);
    onChange(next);
  };

  const atMax = files.length >= max;

  return(
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      {/* Dropzone */}
      <div
        onClick={()=>!atMax && ref.current.click()}
        onDragOver={e=>{e.preventDefault();if(!atMax)setDrag(true);}}
        onDragLeave={()=>setDrag(false)}
        onDrop={e=>{
          e.preventDefault();setDrag(false);
          if(!atMax && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
        style={{
          border:`1.5px dashed ${atMax?C.subtle:files.length>0?C.rec:drag?C.borderHi:C.border}`,
          borderRadius:12,padding:24,textAlign:"center",
          cursor:atMax?"default":"pointer",
          background:files.length>0?C.recBg:drag?C.cardHi:"transparent",
          transition:"all .18s",
          opacity:atMax?0.5:1,
        }}>
        <input ref={ref} type="file" accept={accept} multiple style={{display:"none"}}
          onChange={e=>{if(e.target.files.length) addFiles(e.target.files); e.target.value=null;}}/>
        <div style={{fontSize:30,marginBottom:8,opacity:0.7}}>{files.length>0?"📂":"📎"}</div>
        <div style={{fontSize:14,color:C.text,fontWeight:600,marginBottom:4}}>
          {files.length===0 ? label : `${S.upload_more}`}
        </div>
        <div style={{fontSize:11,color:C.muted,fontFamily:C.mono,letterSpacing:".03em"}}>
          {atMax ? S.upload_max : `${files.length} / ${max} ${files.length===1?S.upload_file:S.upload_files} · ${S.upload_drop}`}
        </div>
        {hint && files.length===0 && (
          <div style={{fontSize:11,color:C.muted+"AA",marginTop:6,fontFamily:C.mono}}>{hint}</div>
        )}
      </div>

      {/* File chips grid */}
      {files.length>0 && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(82px, 1fr))",gap:8}}>
          {files.map((f,i)=>(
            <div key={i} style={{
              position:"relative",
              background:C.card,border:`1px solid ${C.border}`,borderRadius:10,
              padding:6,
              animation:"fadeIn .3s",
              overflow:"hidden",
            }}>
              {/* Preview area */}
              <div style={{
                width:"100%",height:64,borderRadius:7,
                background:f.preview?`url(${f.preview}) center/cover`:C.bg,
                marginBottom:6,
                display:"flex",alignItems:"center",justifyContent:"center",
                border:`1px solid ${C.border}`,
              }}>
                {!f.preview && <span style={{fontSize:22,opacity:0.6}}>📄</span>}
              </div>
              {/* Name */}
              <div style={{
                fontSize:9,color:C.textDim,fontFamily:C.mono,
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                direction:"ltr",textAlign:isRTL?"right":"left",
              }} title={f.name}>{f.name}</div>
              {/* Delete X */}
              <button
                onClick={(e)=>{e.stopPropagation();removeFile(i);}}
                style={{
                  position:"absolute",top:4,right:4,
                  width:20,height:20,borderRadius:"50%",
                  background:"rgba(0,0,0,.7)",border:`1px solid ${C.border}`,
                  color:C.text,cursor:"pointer",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:10,fontWeight:700,
                  transition:"all .15s",
                }}
                onMouseOver={e=>{e.currentTarget.style.background="#EF4444";e.currentTarget.style.borderColor="#EF4444";}}
                onMouseOut={e=>{e.currentTarget.style.background="rgba(0,0,0,.7)";e.currentTarget.style.borderColor=C.border;}}
              >×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ─── UI Primitives ───────────────────────────────────────────────

function Inp({v,onChange,ph,dir}){
  return <input value={v||""} onChange={e=>onChange(e.target.value)} placeholder={ph} dir={dir||"ltr"}
    style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"13px 15px",color:C.text,fontSize:14,fontFamily:C.sans,outline:"none",boxSizing:"border-box",textAlign:dir==="rtl"?"right":"left",transition:"border-color .15s"}}
    onFocus={e=>e.target.style.borderColor=C.borderHi}
    onBlur={e=>e.target.style.borderColor=C.border}/>;
}

function TA({v,onChange,ph,rows=3}){
  return <textarea value={v||""} onChange={e=>onChange(e.target.value)} placeholder={ph} rows={rows}
    style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"13px 15px",color:C.text,fontSize:14,fontFamily:C.sans,resize:"vertical",outline:"none",boxSizing:"border-box",lineHeight:1.6,transition:"border-color .15s"}}
    onFocus={e=>e.target.style.borderColor=C.borderHi}
    onBlur={e=>e.target.style.borderColor=C.border}/>;
}

function Chip({label,sel,color,onClick,disabled}){
  return <button onClick={()=>{haptic();onClick();}} disabled={disabled&&!sel}
    style={{padding:"9px 15px",borderRadius:40,border:"1px solid",borderColor:sel?color:C.border,
      background:sel?color+"22":"transparent",color:sel?color:C.textDim,
      cursor:disabled&&!sel?"default":"pointer",fontSize:13,fontFamily:C.sans,fontWeight:sel?600:400,
      transition:"all .18s cubic-bezier(.4,0,.2,1)",whiteSpace:"nowrap",
      transform:sel?"scale(1.02)":"scale(1)",
      opacity:disabled&&!sel?0.4:1}}>
    {label}
  </button>;
}

function SelCard({children,sel,color,onClick}){
  return <button onClick={()=>{haptic();onClick();}}
    style={{textAlign:"left",padding:"15px",borderRadius:12,
      border:`1.5px solid ${sel?color:C.border}`,
      background:sel?color+"14":C.card,cursor:"pointer",
      transition:"all .18s cubic-bezier(.4,0,.2,1)",width:"100%",
      boxShadow:sel?`0 0 0 3px ${color}1A`:"none",
      transform:sel?"translateY(-1px)":"translateY(0)"}}>
    {children}
  </button>;
}

function RecBadge({label="Recommended for better results",boost="+5%"}){
  return(
    <div style={{display:"flex",alignItems:"center",gap:8,margin:"22px 0 12px"}}>
      <div style={{flex:1,height:1,background:`linear-gradient(90deg,transparent,${C.border})`}}/>
      <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 11px",borderRadius:20,border:`1px solid ${C.rec}44`,background:C.recBg}}>
        <span style={{color:C.rec,fontSize:9}}>✦</span>
        <span style={{color:C.rec,fontSize:10,fontFamily:C.mono,letterSpacing:".02em"}}>{label}</span>
        {boost && <span style={{color:C.green,fontSize:9,fontFamily:C.mono,fontWeight:700,padding:"1px 5px",background:"rgba(34,197,94,.12)",borderRadius:4,marginLeft:2}}>{boost}</span>}
      </div>
      <div style={{flex:1,height:1,background:`linear-gradient(90deg,${C.border},transparent)`}}/>
    </div>
  );
}

function UpZone({v,onChange,label,hint,accept="image/*"}){
  const ref=useRef();
  const [drag,setDrag]=useState(false);
  return(
    <div
      onClick={()=>ref.current.click()}
      onDragOver={e=>{e.preventDefault();setDrag(true);}}
      onDragLeave={()=>setDrag(false)}
      onDrop={e=>{e.preventDefault();setDrag(false);if(e.dataTransfer.files[0]){haptic(20);onChange(e.dataTransfer.files[0].name);}}}
      style={{border:`1.5px dashed ${v?C.rec:drag?C.borderHi:C.border}`,borderRadius:12,padding:24,textAlign:"center",cursor:"pointer",background:v?C.recBg:drag?C.cardHi:"transparent",transition:"all .18s"}}>
      <input ref={ref} type="file" accept={accept} style={{display:"none"}} onChange={e=>{if(e.target.files[0]){haptic(20);onChange(e.target.files[0].name);}}}/>
      {v?
        <div>
          <div style={{fontSize:20,marginBottom:6,color:C.rec}}>✓ Uploaded</div>
          <div style={{fontSize:11,color:C.rec,fontFamily:C.mono,wordBreak:"break-all"}}>{v}</div>
        </div>
        :<div>
          <div style={{fontSize:30,marginBottom:8,opacity:0.7}}>📎</div>
          <div style={{fontSize:13,color:C.text,fontWeight:500}}>{label}</div>
          {hint&&<div style={{fontSize:11,color:C.muted,marginTop:4,fontFamily:C.mono}}>{hint}</div>}
        </div>
      }
    </div>
  );
}

function Slider({value=50,onChange,leftLabel,rightLabel,color}){
  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:8,fontSize:12,fontFamily:C.mono,color:C.textDim}}>
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
      <div style={{position:"relative",height:36,padding:"15px 0"}}>
        <div style={{height:6,background:C.border,borderRadius:3,position:"relative"}}>
          <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${value}%`,background:color,borderRadius:3,transition:"width .15s",boxShadow:`0 0 8px ${color}66`}}/>
        </div>
        <input type="range" min={0} max={100} value={value}
          onChange={e=>{haptic(3);onChange(parseInt(e.target.value));}}
          style={{position:"absolute",left:0,right:0,top:0,width:"100%",height:36,margin:0,opacity:0,cursor:"pointer"}}/>
        <div style={{position:"absolute",left:`calc(${value}% - 11px)`,top:7,width:22,height:22,borderRadius:"50%",background:color,boxShadow:`0 0 0 4px ${color}22, 0 2px 8px rgba(0,0,0,.4)`,transition:"left .15s",pointerEvents:"none"}}/>
      </div>
    </div>
  );
}

function RankedSelect({options,value=[],onChange,color,max=3,labels=null}){
  return(
    <div style={{display:"flex",flexDirection:"column",gap:6}}>
      {options.map(o=>{
        const rank=value.indexOf(o);
        const sel=rank>=0;
        return(
          <button key={o}
            onClick={()=>{
              haptic();
              if(sel) onChange(value.filter(x=>x!==o));
              else if(value.length<max) onChange([...value,o]);
            }}
            style={{textAlign:"left",padding:"12px 14px",borderRadius:10,
              border:"1px solid",borderColor:sel?color:C.border,
              background:sel?color+"14":C.card,
              color:sel?C.text:C.textDim,cursor:"pointer",fontSize:13,fontFamily:C.sans,
              display:"flex",alignItems:"center",gap:12,
              transition:"all .15s",
              opacity:!sel&&value.length>=max?0.4:1}}>
            <div style={{width:24,height:24,borderRadius:"50%",
              border:`1.5px solid ${sel?color:C.border}`,
              background:sel?color:"transparent",
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:11,fontWeight:700,color:sel?"#000":C.muted,
              flexShrink:0,fontFamily:C.mono}}>
              {sel?rank+1:""}
            </div>
            <span style={{flex:1}}>{labels?(labels[o]||o):o}</span>
          </button>
        );
      })}
      <div style={{fontFamily:C.mono,fontSize:11,color:C.muted,marginTop:4}}>{value.length}/{max}</div>
    </div>
  );
}

// ─── THE LIVING DNA HELIX ──────────────────────────────────────
// Visual representation of BrandDNA being assembled, one base-pair at a time.
// Each of the 20 questions = one rung in the helix. Locks in with a glow when answered.
function BrandPreview({a, q, expanded, onToggle, lang="en"}){
  const conf = calcConf(a);
  const fams = familyFill(a);
  const moodColor = blendEmotionColor(a.emotions);
  const sector = SECTORS.find(s=>s.v===a.sector);
  const accent = moodColor || sector?.accent || C.rec;

  // Map each of the 20 questions to a "base pair" — figure out which are filled.
  // A base pair is considered "locked" if the user has provided meaningful data for it.
  const pairs = useMemo(()=>{
    const checks = {
      1: !!a.name_en,
      2: !!a.hero_upload || !!a.hero_why,
      3: !!a.sector && !!a.lifecycle,
      4: !!(a.platforms?.length),
      5: a.scale_minmax !== undefined,
      6: !!(a.brand_refs?.length),
      7: !!a.lifestyle,
      8: !!a.pricing,
      9: !!(a.emotions?.length),
      10: !!a.archetype,
      11: !!a.music,
      12: !!(a.restrictions?.length),
      13: !!a.language,
      14: !!(a.occasions_ranked?.length),
      15: !!a.respected,
      16: !!a.goal,
      17: !!(a.problems?.length) || !!a.founding_story, // either qualifies
      18: !!a.founding_story,
      19: !!(a.brand_assets_bundle?.length),
      20: !!a.vision,
    };
    return Array.from({length:20},(_,i)=>{
      const qNum = i+1;
      const ch = CHAPTERS.find(c=>qNum>=c.range[0] && qNum<=c.range[1]);
      return { q:qNum, locked: !!checks[qNum], color: ch.color, family: ch.family, isCurrent: qNum===q };
    });
  },[a,q]);

  const lockedCount = pairs.filter(p=>p.locked).length;
  const dnaStrength = Math.round((lockedCount/20)*100);

  // Helix geometry
  const W = 280;
  const H = expanded ? 360 : 80;
  const PAIRS = 20;
  const padTop = 24;
  const padBottom = 24;
  const usableH = H - padTop - padBottom;
  const step = usableH / (PAIRS-1);
  const amplitude = 36;
  const centerX = W/2;

  // Helper: get x position of each strand at a given y
  const strandX = (i, side) => {
    const t = i / (PAIRS-1);
    const angle = t * Math.PI * 4; // two full twists across 20 pairs
    const offset = Math.sin(side === "L" ? angle : angle + Math.PI) * amplitude;
    return centerX + offset;
  };

  // Build SVG paths for the two strands
  const strandPath = (side) => {
    const points = [];
    for(let i=0;i<PAIRS;i++){
      const y = padTop + i*step;
      const x = strandX(i, side);
      points.push({x,y});
    }
    // Smooth curve through points
    let d = `M ${points[0].x} ${points[0].y}`;
    for(let i=1;i<points.length;i++){
      const prev = points[i-1];
      const curr = points[i];
      const cpY = (prev.y + curr.y)/2;
      d += ` C ${prev.x} ${cpY}, ${curr.x} ${cpY}, ${curr.x} ${curr.y}`;
    }
    return d;
  };

  const S_ = STRINGS[lang] || STRINGS.en;
  const statusCopy =
    dnaStrength === 0 ? S_.status[0] :
    dnaStrength < 20 ? S_.status[1] :
    dnaStrength < 40 ? S_.status[2] :
    dnaStrength < 60 ? S_.status[3] :
    dnaStrength < 75 ? S_.status[4] :
    dnaStrength < 90 ? S_.status[5] :
    dnaStrength < 100 ? S_.status[6] :
    S_.status[7];

  return(
    <div style={{
      position:"relative",
      background:`linear-gradient(180deg, ${C.card}, ${C.cardHi})`,
      border:`1px solid ${C.border}`,
      borderRadius:14,
      overflow:"hidden",
      transition:"all .3s cubic-bezier(.4,0,.2,1)",
    }}>
      {/* Subtle radial glow */}
      <div style={{
        position:"absolute",inset:0,
        background:`radial-gradient(ellipse at center, ${accent}10, transparent 70%)`,
        pointerEvents:"none",
      }}/>

      {/* Header / toggle */}
      <button onClick={onToggle} style={{
        width:"100%",border:"none",background:"transparent",cursor:"pointer",
        padding:"12px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",
        borderBottom:expanded?`1px solid ${C.border}`:"none",
        position:"relative",zIndex:1,
      }}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{width:7,height:7,borderRadius:"50%",background:accent,boxShadow:`0 0 10px ${accent}aa`,animation:"pulse 2s infinite",flexShrink:0}}/>
          <span style={{fontFamily:C.mono,fontSize:10,color:C.textDim,letterSpacing:".15em",fontWeight:600}}>{S_.brand_dna}</span>
          <span style={{fontFamily:C.mono,fontSize:10,color:C.muted,letterSpacing:".08em"}}>· {lockedCount}/20 {S_.pairs}</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontFamily:C.mono,fontSize:14,fontWeight:700,color:accent,letterSpacing:".02em"}}>{dnaStrength}%</span>
          <span style={{transform:expanded?"rotate(180deg)":"none",transition:"transform .2s",color:C.muted,fontSize:10}}>▾</span>
        </div>
      </button>

      {expanded && (
        <div style={{padding:"8px 16px 18px",position:"relative",zIndex:1}}>
          {/* The DNA visualization */}
          <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:18,padding:"8px 0"}}>
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{overflow:"visible"}}>
              <defs>
                {/* Glow filter for locked pairs */}
                <filter id="glow">
                  <feGaussianBlur stdDeviation="2.5" result="blur"/>
                  <feMerge>
                    <feMergeNode in="blur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
                {/* Strong glow for current pair */}
                <filter id="glow-strong">
                  <feGaussianBlur stdDeviation="4" result="blur"/>
                  <feMerge>
                    <feMergeNode in="blur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
                {/* Gradient for strands */}
                <linearGradient id="strand-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHAPTERS[0].color} stopOpacity="0.6"/>
                  <stop offset="25%" stopColor={CHAPTERS[1].color} stopOpacity="0.6"/>
                  <stop offset="50%" stopColor={CHAPTERS[2].color} stopOpacity="0.6"/>
                  <stop offset="75%" stopColor={CHAPTERS[3].color} stopOpacity="0.6"/>
                  <stop offset="100%" stopColor={CHAPTERS[4].color} stopOpacity="0.6"/>
                </linearGradient>
              </defs>

              {/* Two strands as gradient curves */}
              <path d={strandPath("L")} fill="none" stroke="url(#strand-grad)" strokeWidth="1.5" opacity="0.5"/>
              <path d={strandPath("R")} fill="none" stroke="url(#strand-grad)" strokeWidth="1.5" opacity="0.5"/>

              {/* Base pairs — rungs between strands */}
              {pairs.map((p,i)=>{
                const y = padTop + i*step;
                const xL = strandX(i,"L");
                const xR = strandX(i,"R");
                const isLocked = p.locked;
                const isCurrent = p.isCurrent;
                const dim = !isLocked && !isCurrent;

                return(
                  <g key={p.q} style={{transition:"all .4s"}}>
                    {/* Rung line */}
                    <line
                      x1={xL} y1={y} x2={xR} y2={y}
                      stroke={isLocked ? p.color : C.subtle}
                      strokeWidth={isLocked ? 2 : 1}
                      strokeDasharray={dim ? "2 3" : "none"}
                      opacity={isLocked ? 0.85 : dim ? 0.35 : 0.6}
                      filter={isLocked ? "url(#glow)" : ""}
                    />
                    {/* Left node */}
                    <circle
                      cx={xL} cy={y} r={isLocked?4:isCurrent?4:2.5}
                      fill={isLocked ? p.color : isCurrent ? p.color : C.subtle}
                      opacity={isLocked ? 1 : isCurrent ? 0.95 : 0.4}
                      filter={isLocked || isCurrent ? "url(#glow)" : ""}
                    >
                      {isCurrent && !isLocked && (
                        <animate attributeName="opacity" values="0.4;1;0.4" dur="1.5s" repeatCount="indefinite"/>
                      )}
                    </circle>
                    {/* Right node */}
                    <circle
                      cx={xR} cy={y} r={isLocked?4:isCurrent?4:2.5}
                      fill={isLocked ? p.color : isCurrent ? p.color : C.subtle}
                      opacity={isLocked ? 1 : isCurrent ? 0.95 : 0.4}
                      filter={isLocked || isCurrent ? "url(#glow)" : ""}
                    >
                      {isCurrent && !isLocked && (
                        <animate attributeName="opacity" values="0.4;1;0.4" dur="1.5s" repeatCount="indefinite"/>
                      )}
                    </circle>
                    {/* Family label on locked pairs — every 4 */}
                    {isLocked && i%4===0 && (
                      <text
                        x={W-8} y={y+3}
                        fontSize="8" fontFamily={C.mono}
                        fill={p.color} opacity="0.7"
                        textAnchor="end"
                        letterSpacing=".05em"
                      >{p.family}</text>
                    )}
                  </g>
                );
              })}

              {/* Current question marker — small arrow */}
              {q<=20 && (
                <g>
                  <text x="8" y={padTop + (q-1)*step + 3}
                    fontSize="9" fontFamily={C.mono}
                    fill={accent} fontWeight="700"
                    letterSpacing=".05em">
                    Q{String(q).padStart(2,"0")}
                  </text>
                </g>
              )}
            </svg>

            {/* Right side: family fill stack */}
            <div style={{display:"flex",flexDirection:"column",gap:10,minWidth:90}}>
              {(()=>{
                const cmap={A:CHAPTERS[0].color,E:CHAPTERS[1].color,B:CHAPTERS[2].color,C:CHAPTERS[3].color,D:CHAPTERS[4].color};
                return S_.families.map(f=>({...f,c:cmap[f.k]}));
              })().map(f=>(
                <div key={f.k} style={{display:"flex",alignItems:"center",gap:8,fontSize:11}}>
                  <span style={{
                    width:18,height:18,borderRadius:5,
                    background: fams[f.k] ? f.c+"33" : "transparent",
                    border:`1px solid ${fams[f.k] ? f.c : C.border}`,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontFamily:C.mono,fontSize:9,fontWeight:700,
                    color: fams[f.k] ? f.c : C.muted,
                    boxShadow: fams[f.k] ? `0 0 10px ${f.c}44` : "none",
                    transition:"all .4s",
                  }}>{f.k}</span>
                  <div style={{display:"flex",flexDirection:"column",gap:2}}>
                    <span style={{fontFamily:C.mono,fontSize:9,color:fams[f.k]?C.text:C.muted,letterSpacing:".05em",fontWeight:fams[f.k]?600:400}}>{f.l.toUpperCase()}</span>
                    <span style={{fontFamily:C.mono,fontSize:8,color:fams[f.k]?C.green:C.muted,letterSpacing:".05em"}}>{fams[f.k]?S_.locked:S_.partial}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Status line */}
          <div style={{
            marginTop:8,paddingTop:14,borderTop:`1px solid ${C.border}`,
            display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,
          }}>
            <div style={{fontFamily:C.serif,fontSize:13,color:C.textDim,fontStyle:"italic",lineHeight:1.4}}>
              {statusCopy}
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontFamily:C.mono,fontSize:8,color:C.muted,letterSpacing:".15em"}}>{S_.strength}</div>
              <div style={{fontFamily:C.mono,fontSize:18,fontWeight:700,color:accent,lineHeight:1}}>{dnaStrength}<span style={{fontSize:10,color:C.muted,fontWeight:400}}>%</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// Q5 special live preview — the showpiece for the slider question
function SliderLivePreview({a, sector, lang="en"}){
  const density = a.scale_minmax ?? 50;
  const saturation = a.scale_quietloud ?? 50;
  const isGlobal = (a.scale_localglobal ?? 50) > 50;
  const isModern = (a.scale_tradmod ?? 50) > 50;
  const sectorObj = SECTORS.find(s=>s.v===sector);
  const accent = sectorObj?.accent || "#7C6AF5";

  // Map slider values to actual visual properties
  const padding = 32 - (density/100)*18;
  const elements = density > 70 ? 4 : density > 40 ? 3 : 2;
  const baseSat = saturation/100;
  const fontFamily = isModern ? "'DM Sans', sans-serif" : "'Fraunces', serif";
  const direction = isGlobal ? "ltr" : "rtl";
  const sampleName = a.name_en || "YOUR BRAND";
  const sampleAr = a.name_ar || "اسم العلامة";

  return(
    <div style={{
      position:"relative",
      borderRadius:14,
      overflow:"hidden",
      border:`1px solid ${C.border}`,
      marginTop:8,
    }}>
      {/* Tag */}
      <div style={{
        padding:"8px 14px",
        fontFamily:C.mono,fontSize:10,color:C.muted,letterSpacing:".12em",
        borderBottom:`1px solid ${C.border}`,
        background:C.bg,
        display:"flex",alignItems:"center",justifyContent:"space-between",
      }}>
        <span>{(STRINGS[lang]||STRINGS.en).sub_live_post}</span>
        <span style={{color:accent,fontSize:9}}>{(STRINGS[lang]||STRINGS.en).live}</span>
      </div>

      {/* The actual preview tile — this is what changes with sliders */}
      <div style={{
        background:`linear-gradient(135deg, ${accent}${Math.round(baseSat*40+10).toString(16).padStart(2,"0")}, ${C.card})`,
        padding,
        minHeight:240,
        display:"flex",flexDirection:"column",
        justifyContent: density > 60 ? "space-between" : "center",
        transition:"all .25s cubic-bezier(.4,0,.2,1)",
        position:"relative",
      }}>
        {/* Top mark / sector pip */}
        {elements >= 3 && (
          <div style={{
            display:"flex",alignItems:"center",gap:8,
            opacity: 0.4 + baseSat*0.6,
            direction,
          }}>
            <span style={{
              width:8,height:8,borderRadius:"50%",
              background:accent,boxShadow:`0 0 8px ${accent}aa`,
            }}/>
            <span style={{fontFamily:C.mono,fontSize:9,letterSpacing:".15em",color:accent,fontWeight:600}}>
              {sectorObj?.l.toUpperCase()||"BRAND"}
            </span>
          </div>
        )}

        {/* Main hero */}
        <div style={{
          textAlign:isGlobal?"left":"right",
          direction,
          margin: density > 60 ? "0" : "auto 0",
        }}>
          <div style={{
            fontFamily,
            fontWeight: isModern ? 800 : 700,
            fontSize: 28 + baseSat*8,
            color:C.text,
            lineHeight:1.05,
            letterSpacing: isModern ? "-.02em" : "0",
            textTransform: isModern && saturation > 60 ? "uppercase" : "none",
            transition:"all .25s",
            fontStyle: !isModern && !isGlobal ? "italic" : "normal",
          }}>
            {isGlobal ? sampleName : sampleAr}
          </div>

          {elements >= 2 && (
            <div style={{
              fontFamily:C.mono,
              fontSize:11,
              color:accent,
              marginTop:10,
              letterSpacing:".1em",
              opacity:0.6+baseSat*0.4,
              transition:"all .25s",
            }}>
              {isModern ? "EST. 2026 — RIYADH" : "ريــاض"}
            </div>
          )}
        </div>

        {/* Bottom block — appears at high density */}
        {elements >= 4 && (
          <div style={{
            marginTop: 14,
            paddingTop: 14,
            borderTop: `1px solid ${accent}33`,
            display:"flex",justifyContent:"space-between",alignItems:"center",
            opacity: baseSat,
          }}>
            <span style={{fontFamily:C.mono,fontSize:9,color:C.textDim,letterSpacing:".1em"}}>
              SCROLL · TAP · ORDER
            </span>
            <span style={{
              padding:"4px 10px",borderRadius:20,
              background:accent,color:"#000",
              fontFamily:C.mono,fontSize:9,fontWeight:700,letterSpacing:".05em",
            }}>{isModern?"SHOP":"اطلب"}</span>
          </div>
        )}
      </div>

      <div style={{
        padding:"10px 14px",fontSize:11,color:C.muted,fontFamily:C.mono,
        background:C.card,borderTop:`1px solid ${C.border}`,
        letterSpacing:".03em",
      }}>
        {(STRINGS[lang]||STRINGS.en).sub_sliders}
      </div>
    </div>
  );
}

// Milestone overlay
function MilestoneToast({msg, color, onDone, lang="en"}){
  useEffect(()=>{
    const t=setTimeout(onDone, 2800);
    return ()=>clearTimeout(t);
  },[]);
  return(
    <div style={{
      position:"fixed",top:80,left:"50%",transform:"translateX(-50%)",
      background:C.card,border:`1px solid ${color}`,
      borderRadius:12,padding:"14px 22px",
      boxShadow:`0 8px 32px rgba(0,0,0,.6), 0 0 0 4px ${color}22`,
      zIndex:50,
      animation:"slideDown .4s cubic-bezier(.4,0,.2,1)",
      maxWidth:"calc(100vw - 32px)",
      textAlign:"center",
    }}>
      <div style={{fontFamily:C.mono,fontSize:9,color,letterSpacing:".15em",marginBottom:4}}>{(STRINGS[lang]||STRINGS.en).milestone_label}</div>
      <div style={{fontFamily:C.serif,fontSize:16,color:C.text,fontStyle:"italic",fontWeight:600}}>{msg}</div>
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────

// ─── App ─────────────────────────────────────────────────────────

export default function App(){
  useFonts();
  const [lang,setLang]=useState("en"); // "en" | "ar"
  const [stage,setStage]=useState("welcome");
  const [q,setQ]=useState(1);
  const [showIntro,setShowIntro]=useState(false);
  const [a,setA]=useState({});
  const [copied,setCopied]=useState(false);
  const [archetypeStep,setArchetypeStep]=useState(0);
  const [previewOpen,setPreviewOpen]=useState(true);
  const [hitMilestones,setHitMilestones]=useState(new Set());
  const [milestone,setMilestone]=useState(null);

  const S=STRINGS[lang];
  const isRTL=lang==="ar";
  const set=(k,v)=>setA(p=>({...p,[k]:v}));
  const ch=getChapter(q);
  const conf=calcConf(a);
  const fams=familyFill(a);
  const accent = blendEmotionColor(a.emotions) || SECTORS.find(s=>s.v===a.sector)?.accent || ch.color;

  useEffect(()=>{
    for(let i=0;i<MILESTONES.length;i++){
      const m=MILESTONES[i];
      if(conf >= m.at && !hitMilestones.has(m.at)){
        setHitMilestones(p=>new Set([...p,m.at]));
        setMilestone({msg:S.milestones[i], color:accent});
        haptic([20,40,20]);
        break;
      }
    }
  },[conf]);

  const advance=()=>{
    if(q===20){setStage("done");haptic([20,30,80]);return;}
    const next=q+1;
    setQ(next);
    setArchetypeStep(0);
    if(isChapterStart(next))setShowIntro(true);
    window.scrollTo({top:0,behavior:"smooth"});
  };
  const back=()=>{
    if(q===1){setStage("welcome");return;}
    setQ(q=>q-1);
    setArchetypeStep(0);
    setShowIntro(false);
  };

  const dna={
    meta:{
      schema_version:"BrandDNA V2",
      confidence:`${conf}%`,
      created:new Date().toISOString(),
      visual_layer:"fal.ai",
      chain_pool:"Phase 1 · 88 chains",
      onboarding_lang:lang,
      families_populated:Object.entries(fams).filter(([_,v])=>v).map(([k])=>k),
    },
    family_A_identity:{
      name_en:a.name_en,name_ar:a.name_ar,name_meaning:a.name_meaning,
      tagline:a.tagline,founding_story:a.founding_story,
      lifecycle_stage:a.lifecycle,
      archetype_family:a.archetype_family,archetype_primary:a.archetype,
      brand_refs:a.brand_refs,
      scale_minimal_maximal:a.scale_minmax,scale_quiet_loud:a.scale_quietloud,
      scale_local_global:a.scale_localglobal,scale_traditional_modern:a.scale_tradmod,
      scale_custom:a.scale_custom,
      music_mood:a.music,music_link:a.music_link,
    },
    family_B_policy:{
      restrictions:a.restrictions,custom_restriction:a.custom_restriction,
      language:a.language,caption_example:a.caption_ex,
    },
    family_C_evidence:{
      pricing_tier:a.pricing,price_range:a.price_nums,
      respected_brands:a.respected,respected_why:a.respected_why,
      hero_upload:a.hero_upload,hero_why:a.hero_why,
      brand_files:a.brand_files,
      brand_assets_bundle:a.brand_assets_bundle, // NEW: array of files
      past_problems:a.problems,
    },
    family_D_memory_seed:{
      intent_primary:a.goal,success_metric:a.metric,
      vision_12mo:a.vision,vision_text:a.vision_text,
      open_notes:a.anything,
    },
    family_E_context:{
      sector:a.sector,platforms:a.platforms,handles:a.social,
      audience_lifestyle:a.lifestyle,audience_description:a.cust_desc,
      target_emotions:a.emotions,customer_quote:a.cust_quote,
      occasions_ranked:a.occasions_ranked,custom_occasion:a.custom_occasion,
    },
  };

  const globalStyles = (
    <style>{`
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
      @keyframes slideDown { from { transform: translate(-50%, -20px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes reveal { 0% { opacity: 0; transform: scale(.92); } 50% { opacity: 1; transform: scale(1.02); } 100% { opacity: 1; transform: scale(1); } }
    `}</style>
  );

  // RTL-aware arrow
  const arrowFwd = isRTL ? "←" : "→";
  const arrowBack = isRTL ? "→" : "←";

  // ═══ WELCOME ════════════════════════════════════════════════
  if(stage==="welcome") return(<>
    {globalStyles}
    <div dir={isRTL?"rtl":"ltr"} style={{background:C.bg,minHeight:"100vh",fontFamily:isRTL?C.sans:C.sans,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 20px",textAlign:"center",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:-200,left:"50%",transform:"translateX(-50%)",width:600,height:600,borderRadius:"50%",background:`radial-gradient(circle, ${CHAPTERS[0].color}14 0%, transparent 70%)`,pointerEvents:"none"}}/>

      <div style={{position:"relative",zIndex:1}}>
        <div style={{fontFamily:C.mono,fontSize:10,color:C.muted,letterSpacing:".25em",marginBottom:32}}>
          {S.setup_label}
        </div>

        {/* Language toggle — highly visible */}
        <div style={{display:"flex",justifyContent:"center",gap:8,marginBottom:32}}>
          <button onClick={()=>{haptic();setLang("en");}}
            style={{padding:"7px 18px",borderRadius:40,border:"1px solid",
              borderColor:lang==="en"?CHAPTERS[0].color:C.border,
              background:lang==="en"?CHAPTERS[0].color+"22":"transparent",
              color:lang==="en"?CHAPTERS[0].color:C.textDim,
              fontSize:12,fontFamily:C.mono,fontWeight:600,cursor:"pointer",
              transition:"all .15s",letterSpacing:".08em",
            }}>EN</button>
          <button onClick={()=>{haptic();setLang("ar");}}
            style={{padding:"7px 18px",borderRadius:40,border:"1px solid",
              borderColor:lang==="ar"?CHAPTERS[0].color:C.border,
              background:lang==="ar"?CHAPTERS[0].color+"22":"transparent",
              color:lang==="ar"?CHAPTERS[0].color:C.textDim,
              fontSize:13,fontFamily:C.serif,fontWeight:700,cursor:"pointer",
              transition:"all .15s",
            }}>عربي</button>
        </div>

        <h1 style={{fontFamily:C.serif,fontSize:46,fontWeight:800,color:C.text,lineHeight:1.05,marginBottom:20,maxWidth:420,letterSpacing:"-.025em",margin:"0 auto 20px"}}>
          {isRTL ? (
            <>{S.welcome_h1a} <span style={{color:CHAPTERS[0].color,fontStyle:"italic"}}>{S.welcome_h1b}</span></>
          ) : (
            <>{S.welcome_h1a} <span style={{color:CHAPTERS[0].color,fontStyle:"italic"}}>{S.welcome_h1b}</span></>
          )}
        </h1>
        <p style={{fontSize:14,color:C.textDim,maxWidth:380,lineHeight:1.7,marginBottom:18,margin:"0 auto 18px"}}>
          {S.welcome_p1}
        </p>
        <p style={{fontSize:12,color:C.muted,maxWidth:360,lineHeight:1.7,marginBottom:36,margin:"0 auto 36px",fontFamily:isRTL?C.sans:C.mono,letterSpacing:isRTL?"0":".03em",whiteSpace:"pre-line"}}>
          {S.welcome_p2}
        </p>

        <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:36,width:"100%",maxWidth:340,margin:"0 auto 36px"}}>
          {CHAPTERS.map((c,i)=>(
            <div key={c.id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",background:c.bg,border:`1px solid ${c.color}22`,borderRadius:10,opacity:0,animation:`fadeIn .5s ${i*100}ms forwards`}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:c.color,flexShrink:0,boxShadow:`0 0 8px ${c.color}66`}}/>
              <span style={{fontSize:13,color:C.text,fontWeight:500}}>{S.chapters[c.id]}</span>
              <span style={{fontSize:10,color:C.muted,marginInlineStart:"auto",fontFamily:C.mono}}>Q{c.range[0]}–{c.range[1]}</span>
            </div>
          ))}
        </div>

        <button onClick={()=>{haptic();setStage("question");setShowIntro(true);}}
          style={{background:CHAPTERS[0].color,color:"#000",border:"none",borderRadius:10,padding:"15px 40px",fontSize:14,fontWeight:700,fontFamily:isRTL?C.sans:C.mono,cursor:"pointer",letterSpacing:isRTL?"0":".06em",width:"100%",maxWidth:340,boxShadow:`0 0 24px ${CHAPTERS[0].color}55`,transition:"transform .15s"}}>
          {S.welcome_btn}
        </button>
        <div style={{fontFamily:isRTL?C.sans:C.mono,fontSize:11,color:C.muted,marginTop:16,letterSpacing:isRTL?"0":".05em"}}>
          {S.welcome_footer}
        </div>
      </div>
    </div>
  </>);

  // ═══ CHAPTER INTRO ═══════════════════════════════════════════
  if(stage==="question"&&showIntro) return(<>
    {globalStyles}
    <div dir={isRTL?"rtl":"ltr"} style={{background:ch.bg,minHeight:"100vh",fontFamily:C.sans,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32,textAlign:"center",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",width:600,height:600,borderRadius:"50%",background:`radial-gradient(circle, ${ch.color}1A 0%, transparent 60%)`,pointerEvents:"none",animation:"pulse 4s ease-in-out infinite"}}/>

      <div style={{position:"relative",zIndex:1,animation:"reveal .6s cubic-bezier(.4,0,.2,1)"}}>
        <div style={{width:72,height:72,borderRadius:"50%",background:ch.color+"15",border:`1px solid ${ch.color}33`,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:28,margin:"0 auto 28px",boxShadow:`0 0 48px ${ch.color}33`}}>
          <span style={{fontFamily:C.mono,fontSize:18,fontWeight:700,color:ch.color,letterSpacing:".05em"}}>0{ch.id}</span>
        </div>
        <h2 style={{fontFamily:C.serif,fontSize:44,fontWeight:800,color:C.text,marginBottom:12,letterSpacing:"-.025em"}}>{S.chapters[ch.id]}</h2>
        <p style={{fontSize:14,color:C.textDim,marginBottom:8}}>{S.chapter_intros[ch.id]}</p>
        <p style={{fontSize:11,color:C.muted,marginBottom:44,fontFamily:C.mono,letterSpacing:".15em"}}>{S.branddna_family} {ch.family}</p>
        <button onClick={()=>{haptic();setShowIntro(false);}}
          style={{background:ch.color,color:"#000",border:"none",borderRadius:10,padding:"15px 40px",fontSize:13,fontWeight:700,fontFamily:isRTL?C.sans:C.mono,cursor:"pointer",letterSpacing:isRTL?"0":".08em",boxShadow:`0 0 32px ${ch.color}44`}}>
          {S.let_go}
        </button>
      </div>
    </div>
  </>);

  // ═══ DONE ═══════════════════════════════════════════════════
  if(stage==="done") return(<>
    {globalStyles}
    <div dir={isRTL?"rtl":"ltr"} style={{background:C.bg,minHeight:"100vh",fontFamily:C.sans,padding:20,position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:-300,left:"50%",transform:"translateX(-50%)",width:800,height:800,borderRadius:"50%",background:`radial-gradient(circle, ${accent}14 0%, transparent 60%)`,pointerEvents:"none"}}/>

      <div style={{position:"relative",zIndex:1,maxWidth:520,margin:"0 auto"}}>
        <div style={{textAlign:"center",padding:"40px 0 28px",animation:"reveal .8s"}}>
          <div style={{fontSize:11,fontFamily:C.mono,color:C.green,letterSpacing:".2em",marginBottom:14}}>{S.done_label}</div>
          <div style={{fontFamily:C.serif,fontSize:40,fontWeight:800,color:C.text,letterSpacing:"-.025em",lineHeight:1.1}}>{a.name_en||(isRTL?"علامتك":"Your Brand")}</div>
          {a.name_ar&&<div style={{fontSize:20,color:C.textDim,direction:"rtl",marginTop:8,fontFamily:C.serif}}>{a.name_ar}</div>}
          {a.tagline && <div style={{fontFamily:C.serif,fontSize:14,color:accent,fontStyle:"italic",marginTop:14}}>"{a.tagline}"</div>}
        </div>

        <div style={{marginBottom:20,animation:"reveal .8s .2s both"}}>
          <BrandPreview a={a} q={20} expanded={true} onToggle={()=>{}} lang={lang}/>
        </div>

        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:20,marginBottom:14,animation:"fadeIn .6s .5s both"}}>
          <div style={{fontFamily:C.mono,fontSize:10,color:C.muted,marginBottom:12,letterSpacing:".12em"}}>{S.done_strength_lbl}</div>
          <div style={{height:10,background:C.border,borderRadius:5,marginBottom:12,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${conf}%`,background:`linear-gradient(90deg, ${conf>=75?C.green:conf>=50?CHAPTERS[0].color:CHAPTERS[2].color}, ${accent})`,borderRadius:5,transition:"width 1s",boxShadow:`0 0 12px ${accent}66`}}/>
          </div>
          <div style={{display:"flex",alignItems:"baseline",gap:10}}>
            <div style={{fontFamily:C.mono,fontSize:28,fontWeight:700,color:C.text}}>{conf}%</div>
            <div style={{fontSize:12,color:C.textDim,fontStyle:"italic"}}>
              {conf>=90?S.milestones[3]:conf>=75?S.milestones[2]:conf>=50?S.milestones[1]:S.milestones[0]}
            </div>
          </div>
        </div>

        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:20,marginBottom:14,animation:"fadeIn .6s .7s both"}}>
          <div style={{fontFamily:C.mono,fontSize:10,color:C.muted,marginBottom:14,letterSpacing:".12em"}}>{S.done_schema_lbl}</div>
          <div style={{display:"flex",flexDirection:"column",gap:9}}>
            {S.families.map((f)=>{
              const colorMap={A:CHAPTERS[0].color,B:CHAPTERS[2].color,C:CHAPTERS[3].color,D:CHAPTERS[4].color,E:CHAPTERS[1].color};
              const fc=colorMap[f.k];
              return(
                <div key={f.k} style={{display:"flex",alignItems:"center",gap:10,fontSize:13}}>
                  <span style={{width:24,height:24,borderRadius:5,background:fc+"22",border:`1px solid ${fc}44`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:C.mono,fontSize:11,fontWeight:700,color:fc}}>{f.k}</span>
                  <span style={{color:C.text,fontFamily:C.sans}}>{f.l}</span>
                  <span style={{marginInlineStart:"auto",fontFamily:C.mono,fontSize:10,color:fams[f.k]?C.green:C.muted}}>
                    {fams[f.k]?S.locked:S.partial}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <button onClick={()=>{
          haptic();
          const j=JSON.stringify(dna,null,2);
          if(navigator.clipboard){navigator.clipboard.writeText(j);}
          else{const t=document.createElement("textarea");t.value=j;document.body.appendChild(t);t.select();document.execCommand("copy");document.body.removeChild(t);}
          setCopied(true);setTimeout(()=>setCopied(false),2200);
        }} style={{width:"100%",fontFamily:isRTL?C.sans:C.mono,fontSize:12,padding:16,border:"1px solid",borderColor:copied?C.green:accent,background:copied?"rgba(34,197,94,.08)":accent+"15",color:copied?C.green:accent,cursor:"pointer",borderRadius:10,fontWeight:700,marginBottom:10,letterSpacing:isRTL?"0":".06em",transition:"all .2s"}}>
          {copied?S.done_copied:S.done_copy_btn}
        </button>
        <button onClick={()=>{setStage("welcome");setQ(1);setA({});setHitMilestones(new Set());}} style={{width:"100%",fontFamily:isRTL?C.sans:C.mono,fontSize:11,padding:13,border:`1px solid ${C.border}`,background:"transparent",color:C.muted,cursor:"pointer",borderRadius:10,letterSpacing:isRTL?"0":".05em"}}>
          {S.done_restart}
        </button>
      </div>
    </div>
  </>);

  // ═══ QUESTION RENDER ═════════════════════════════════════════
  const meta=QMETA_BI[q][lang];
  const sector=a.sector||"other";
  const inputDir = isRTL ? "rtl" : "ltr";

  const renderQ=()=>{
    switch(q){
      case 1: return(<div style={{display:"flex",flexDirection:"column",gap:10}}>
        <Inp v={a.name_en} onChange={v=>set("name_en",v)} ph={TR.ph.name_en[lang]} dir={inputDir}/>
        <Inp v={a.name_ar} onChange={v=>set("name_ar",v)} ph={TR.ph.name_ar.en} dir="rtl"/>
        <RecBadge label={TR.recs.name_meaning[lang]} boost="+5%"/>
        <TA v={a.name_meaning} onChange={v=>set("name_meaning",v)} ph={TR.ph.name_meaning[lang]}/>
      </div>);

      case 2: {
        const hp = TR.hero_product[sector][lang];
        return(<div style={{display:"flex",flexDirection:"column",gap:10}}>
          <UpZone v={a.hero_upload} onChange={v=>set("hero_upload",v)} label={hp.label} hint={hp.hint}/>
          <RecBadge label={TR.recs.hero_anchor[lang]} boost="+5%"/>
          <TA v={a.hero_why} onChange={v=>set("hero_why",v)} ph={TR.hero_why[sector][lang]} rows={3}/>
        </div>);
      }

      case 3: return(<div style={{display:"flex",flexDirection:"column",gap:10}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {SECTORS.map(s=>{const t=TR.sectors[s.v][lang];return(
            <SelCard key={s.v} sel={a.sector===s.v} color={ch.color} onClick={()=>set("sector",s.v)}>
              <div style={{fontSize:24,marginBottom:6}}>{s.e}</div>
              <div style={{fontSize:13,fontWeight:600,color:a.sector===s.v?ch.color:C.text}}>{t.l}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:3,lineHeight:1.4}}>{t.d}</div>
            </SelCard>
          );})}
        </div>
        <RecBadge label={TR.recs.lifecycle[lang]} boost=""/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {LIFECYCLE.map(l=>{const t=TR.lifecycle[l.v][lang];return(
            <SelCard key={l.v} sel={a.lifecycle===l.v} color={ch.color} onClick={()=>set("lifecycle",l.v)}>
              <div style={{fontSize:13,fontWeight:600,color:a.lifecycle===l.v?ch.color:C.text,marginBottom:3}}>{t.l}</div>
              <div style={{fontSize:11,color:C.muted,lineHeight:1.4}}>{t.d}</div>
            </SelCard>
          );})}
        </div>
      </div>);

      case 4: return(<div style={{display:"flex",flexDirection:"column",gap:10}}>
        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
          {Object.entries(TR.platforms).map(([k,arLabel])=>{
            const label = lang==="ar" ? arLabel : k;
            return <Chip key={k} label={label} sel={(a.platforms||[]).includes(k)} color={ch.color} onClick={()=>set("platforms",(a.platforms||[]).includes(k)?(a.platforms||[]).filter(x=>x!==k):[...(a.platforms||[]),k])}/>;
          })}
        </div>
        <RecBadge label={TR.recs.public_only[lang]} boost="+5%"/>
        <Inp v={a.social} onChange={v=>set("social",v)} ph={TR.ph.social[lang]} dir={inputDir}/>
      </div>);

      case 5: return(<div style={{display:"flex",flexDirection:"column",gap:24}}>
        {SCALES.map(s=>(
          <div key={s.k}>
            <Slider value={a[s.k]??50} onChange={v=>set(s.k,v)} leftLabel={s.left} rightLabel={s.right} color={ch.color}/>
            <div style={{fontSize:11,color:C.muted,marginTop:6,fontFamily:C.mono,textAlign:"center"}}>{s.hint}</div>
          </div>
        ))}
        <SliderLivePreview a={a} sector={sector} lang={lang}/>
        <RecBadge label={TR.recs.sliders_missed[lang]} boost="+5%"/>
        <Inp v={a.scale_custom} onChange={v=>set("scale_custom",v)} ph={TR.ph.scale_custom[lang]} dir={inputDir}/>
      </div>);

      case 6: return(<div style={{display:"flex",flexDirection:"column",gap:10}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
          {BRANDS.map(b=>{const s=(a.brand_refs||[]).includes(b);return(
            <button key={b} onClick={()=>{haptic();const sel=a.brand_refs||[];if(sel.includes(b))set("brand_refs",sel.filter(x=>x!==b));else if(sel.length<3)set("brand_refs",[...sel,b]);}}
              style={{padding:"10px 5px",borderRadius:8,border:"1px solid",
                borderColor:s?ch.color:C.border,background:s?ch.color+"18":C.card,
                color:s?ch.color:C.textDim,fontSize:11,fontFamily:C.sans,
                cursor:s||((a.brand_refs||[]).length<3)?"pointer":"default",
                fontWeight:s?600:400,transition:"all .15s",
                transform:s?"scale(1.02)":"scale(1)",
                opacity:!s&&(a.brand_refs||[]).length>=3?0.4:1}}>
              {b}
            </button>
          );})}
        </div>
        <div style={{fontFamily:C.mono,fontSize:11,color:C.muted}}>{(a.brand_refs||[]).length}/3 {S.selected_of}</div>
        <RecBadge label={TR.recs.identity_files[lang]} boost="+5%"/>
        <UpZone v={a.brand_files} onChange={v=>set("brand_files",v)} label={lang==="ar"?"حمّل الشعار، إرشادات العلامة، أو صور مرجعية":"Upload logo, brand guidelines, or reference images"} hint={lang==="ar"?"JPG، PNG، PDF":"JPG, PNG, PDF accepted"} accept=".jpg,.jpeg,.png,.pdf"/>
      </div>);

      case 7: return(<div style={{display:"flex",flexDirection:"column",gap:8}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {LIFESTYLES.map(l=>{const t=TR.lifestyles[l.v][lang];return(
            <SelCard key={l.v} sel={a.lifestyle===l.v} color={ch.color} onClick={()=>set("lifestyle",l.v)}>
              <div style={{fontSize:24,marginBottom:6}}>{l.e}</div>
              <div style={{fontSize:13,fontWeight:600,color:a.lifestyle===l.v?ch.color:C.text}}>{t.l}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:3,lineHeight:1.4}}>{t.d}</div>
            </SelCard>
          );})}
        </div>
        <RecBadge label={TR.recs.one_recommend[lang]} boost="+5%"/>
        <TA v={a.cust_desc} onChange={v=>set("cust_desc",v)} ph={TR.ph.cust_desc[lang]} rows={3}/>
      </div>);

      case 8: return(<div style={{display:"flex",flexDirection:"column",gap:8}}>
        {PRICING.map(p=>{const t=TR.pricing[p.v][lang];return(
          <SelCard key={p.v} sel={a.pricing===p.v} color={ch.color} onClick={()=>set("pricing",p.v)}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{fontSize:14,fontWeight:600,color:a.pricing===p.v?ch.color:C.text}}>{t.l}</div>
                <div style={{fontSize:12,color:C.muted,marginTop:3}}>{t.d}</div>
              </div>
              <span style={{fontSize:10,color:ch.color,background:ch.color+"22",padding:"3px 9px",borderRadius:20,fontFamily:C.mono,flexShrink:0,marginInlineStart:8,fontWeight:600}}>{t.t}</span>
            </div>
          </SelCard>
        );})}
        <RecBadge label={TR.recs.pricing_real[lang]} boost="+5%"/>
        <Inp v={a.price_nums} onChange={v=>set("price_nums",v)} ph={TR.ph.price_nums[lang]} dir={inputDir}/>
      </div>);

      case 9: return(<div style={{display:"flex",flexDirection:"column",gap:10}}>
        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
          {EMOTIONS.map(e=>{const label=lang==="ar"?(TR.emotions[e.l]||e.l):e.l;return(
            <Chip key={e.l} label={label} sel={(a.emotions||[]).includes(e.l)} color={e.c} onClick={()=>{const s=a.emotions||[];if(s.includes(e.l))set("emotions",s.filter(x=>x!==e.l));else if(s.length<3)set("emotions",[...s,e.l]);}} disabled={(a.emotions||[]).length>=3}/>
          );})}
        </div>
        <div style={{fontFamily:C.mono,fontSize:11,color:C.muted}}>{(a.emotions||[]).length}/3 — {TR.q9_count_hint?.[lang]||S.sub_emotions_blend}</div>
        <RecBadge label={TR.recs.customer_quote[lang]} boost="+5%"/>
        <TA v={a.cust_quote} onChange={v=>set("cust_quote",v)} ph={TR.ph.cust_quote[lang]} rows={3}/>
      </div>);

      case 10: {
        const fam = a.archetype_family;
        if(!fam || archetypeStep===0){
          return(<div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div style={{fontSize:12,color:C.textDim,marginBottom:4,fontFamily:C.mono,letterSpacing:".05em"}}>{S.rec_step} 1 {S.rec_of} 2 — {TR.step_pick_family[lang]}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {ARCHETYPE_FAMILIES.map(f=>{const t=TR.archetype_families[f.v][lang];return(
                <SelCard key={f.v} sel={a.archetype_family===f.v} color={f.color}
                  onClick={()=>{set("archetype_family",f.v);set("archetype",null);setArchetypeStep(1);}}>
                  <div style={{fontSize:14,fontWeight:700,color:a.archetype_family===f.v?f.color:C.text,marginBottom:5,fontFamily:f.font,letterSpacing:f.v==="hero"?".02em":0,textTransform:f.v==="hero"?"uppercase":"none",fontStyle:f.v==="creator"?"italic":"normal"}}>{t.l}</div>
                  <div style={{fontSize:11,color:C.muted,lineHeight:1.4}}>{t.d}</div>
                </SelCard>
              );})}
            </div>
          </div>);
        }
        const famObj = ARCHETYPE_FAMILIES.find(f=>f.v===fam);
        const opts = ARCHETYPES[fam];
        return(<div style={{display:"flex",flexDirection:"column",gap:8}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
            <div style={{fontSize:12,color:C.textDim,fontFamily:C.mono,letterSpacing:".05em"}}>{S.rec_step} 2 {S.rec_of} 2 — {TR.archetype_families[fam][lang].l} · {TR.step_archetypes[lang]}</div>
            <button onClick={()=>setArchetypeStep(0)} style={{fontSize:11,fontFamily:C.mono,color:C.muted,background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>{S.rec_change_family}</button>
          </div>
          {opts.map(arc=>{const t=TR.archetypes[arc.v][lang];return(
            <SelCard key={arc.v} sel={a.archetype===arc.v} color={famObj.color} onClick={()=>set("archetype",arc.v)}>
              <div style={{fontSize:14,fontWeight:600,color:a.archetype===arc.v?famObj.color:C.text,marginBottom:5,fontFamily:famObj.font,fontStyle:famObj.v==="creator"?"italic":"normal"}}>{t.l}</div>
              <div style={{fontSize:12,color:C.muted,lineHeight:1.5}}>{t.d}</div>
            </SelCard>
          );})}
          <RecBadge label={TR.recs.on_brand_example[lang]} boost="+5%"/>
          <TA v={a.caption_ex} onChange={v=>set("caption_ex",v)} ph={TR.ph.caption_ex[lang]} rows={3}/>
        </div>);
      }

      case 11: return(<div style={{display:"flex",flexDirection:"column",gap:8}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {MUSIC.map(m=>{const t=TR.music[m.v][lang];return(
            <SelCard key={m.v} sel={a.music===m.v} color={ch.color} onClick={()=>set("music",m.v)}>
              <div style={{fontSize:24,marginBottom:6}}>{m.e}</div>
              <div style={{fontSize:13,fontWeight:600,color:a.music===m.v?ch.color:C.text}}>{t.l}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:3}}>{t.d}</div>
            </SelCard>
          );})}
        </div>
        <RecBadge label={TR.recs.actual_track[lang]} boost="+5%"/>
        <Inp v={a.music_link} onChange={v=>set("music_link",v)} ph={TR.ph.music_link[lang]} dir="ltr"/>
      </div>);

      case 12: return(<div style={{display:"flex",flexDirection:"column",gap:8}}>
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          {RESTRICTIONS.map(r=>{const s=(a.restrictions||[]).includes(r);const label=lang==="ar"?(TR.restrictions[r]||r):r;return(
            <button key={r} onClick={()=>{haptic();const sel=a.restrictions||[];set("restrictions",sel.includes(r)?sel.filter(x=>x!==r):[...sel,r]);}}
              style={{textAlign:isRTL?"right":"left",padding:"12px 14px",borderRadius:8,border:"1px solid",
                borderColor:s?ch.color:C.border,background:s?ch.color+"14":C.card,
                color:s?C.text:C.textDim,cursor:"pointer",fontSize:13,fontFamily:C.sans,
                display:"flex",alignItems:"center",gap:11,transition:"all .15s"}}>
              <div style={{width:18,height:18,borderRadius:5,border:`1.5px solid ${s?ch.color:C.border}`,background:s?ch.color:"transparent",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#000",fontWeight:700,transition:"all .15s"}}>{s?"✓":""}</div>
              {label}
            </button>
          );})}
        </div>
        <RecBadge label={TR.recs.custom_restriction[lang]} boost="+5%"/>
        <TA v={a.custom_restriction} onChange={v=>set("custom_restriction",v)} ph={TR.ph.custom_restriction[lang]} rows={3}/>
      </div>);

      case 13: return(<div style={{display:"flex",flexDirection:"column",gap:8}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {Object.entries(TR.languages).map(([k,arLabel])=>{const label=lang==="ar"?arLabel:k;return(
            <SelCard key={k} sel={a.language===k} color={ch.color} onClick={()=>set("language",k)}>
              <div style={{fontSize:13,fontWeight:500,color:a.language===k?ch.color:C.text}}>{label}</div>
            </SelCard>
          );})}
        </div>
        <RecBadge label={TR.recs.tagline_verbatim[lang]} boost="+5%"/>
        <Inp v={a.tagline} onChange={v=>set("tagline",v)} ph={TR.ph.tagline[lang]} dir={inputDir}/>
      </div>);

      case 14: return(<div style={{display:"flex",flexDirection:"column",gap:10}}>
        <RankedSelect options={OCCASIONS} value={a.occasions_ranked||[]} onChange={v=>set("occasions_ranked",v)} color={ch.color} max={3} labels={lang==="ar"?TR.occasions:null}/>
        <RecBadge label={TR.recs.local_occasion[lang]} boost="+5%"/>
        <Inp v={a.custom_occasion} onChange={v=>set("custom_occasion",v)} ph={TR.ph.custom_occasion[lang]} dir={inputDir}/>
      </div>);

      case 15: return(<div style={{display:"flex",flexDirection:"column",gap:10}}>
        <Inp v={a.respected} onChange={v=>set("respected",v)} ph={TR.ph.respected[lang]} dir={inputDir}/>
        <RecBadge label={TR.recs.respected_why[lang]} boost="+5%"/>
        <TA v={a.respected_why} onChange={v=>set("respected_why",v)} ph={TR.ph.respected_why[lang]} rows={4}/>
      </div>);

      case 16: return(<div style={{display:"flex",flexDirection:"column",gap:8}}>
        {GOALS.map(g=>{const t=TR.goals[g.v][lang];return(
          <SelCard key={g.v} sel={a.goal===g.v} color={ch.color} onClick={()=>set("goal",g.v)}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontSize:24}}>{g.e}</span>
              <div>
                <div style={{fontSize:14,fontWeight:600,color:a.goal===g.v?ch.color:C.text}}>{t.l}</div>
                <div style={{fontSize:12,color:C.muted,marginTop:2}}>{t.d}</div>
              </div>
            </div>
          </SelCard>
        );})}
        <RecBadge label={TR.recs.real_target[lang]} boost="+5%"/>
        <Inp v={a.metric} onChange={v=>set("metric",v)} ph={TR.ph.metric[lang]} dir={inputDir}/>
      </div>);

      case 17: return(<div style={{display:"flex",flexDirection:"column",gap:10}}>
        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
          {PROBLEMS.map(p=>{const label=lang==="ar"?(TR.problems[p]||p):p;return(
            <Chip key={p} label={label} sel={(a.problems||[]).includes(p)} color={ch.color} onClick={()=>{const s=a.problems||[];set("problems",s.includes(p)?s.filter(x=>x!==p):[...s,p]);}}/>
          );})}
        </div>
        <div style={{fontFamily:C.mono,fontSize:11,color:C.muted,padding:"12px 14px",background:C.card,border:`1px solid ${C.border}`,borderRadius:8,lineHeight:1.5}}>
          {TR.problems_intro[lang]}
        </div>
      </div>);

      case 18: return(<div style={{display:"flex",flexDirection:"column",gap:10}}>
        <TA v={a.founding_story} onChange={v=>set("founding_story",v)} ph={TR.ph.founding_story[lang]} rows={5}/>
        <div style={{fontFamily:C.mono,fontSize:11,color:C.muted,padding:"12px 14px",background:C.card,border:`1px solid ${C.border}`,borderRadius:8,lineHeight:1.5}}>
          {TR.story_intro[lang]} <span style={{color:C.green,fontWeight:700}}>+5%</span>
        </div>
      </div>);

      // ═══ Q19 — ONE MULTI-UPLOAD BOX, UP TO 10 FILES ════════
      case 19: return(<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <MultiUpZone
          files={a.brand_assets_bundle||[]}
          onChange={v=>set("brand_assets_bundle",v)}
          label={lang==="ar"?"حمّل كل ملفات علامتك":"Upload all your brand files"}
          hint={TR.recs.upload_max10[lang]}
          accept="*"
          max={10}
          color={ch.color}
          lang={lang}
        />
      </div>);

      case 20: return(<div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {VISIONS.map(v=>{const t=TR.visions[v.v][lang];return(
            <SelCard key={v.v} sel={a.vision===v.v} color={ch.color} onClick={()=>set("vision",v.v)}>
              <div style={{fontSize:24,marginBottom:6}}>{v.e}</div>
              <div style={{fontSize:13,fontWeight:600,color:a.vision===v.v?ch.color:C.text}}>{t.l}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:3,lineHeight:1.4}}>{t.d}</div>
            </SelCard>
          );})}
        </div>
        <TA v={a.vision_text} onChange={v=>set("vision_text",v)} ph={TR.ph.vision_text[lang]} rows={4}/>
        <div style={{height:1,background:C.border,margin:"4px 0"}}/>
        <div style={{fontFamily:C.mono,fontSize:10,color:C.muted,letterSpacing:".1em"}}>{S.optional}</div>
        <TA v={a.anything} onChange={v=>set("anything",v)} ph={TR.ph.anything[lang]} rows={4}/>
      </div>);

      default: return null;
    }
  };

  // ═══ MAIN QUESTION VIEW ══════════════════════════════════════
  return(<>
    {globalStyles}
    <div dir={isRTL?"rtl":"ltr"} style={{background:C.bg,minHeight:"100vh",fontFamily:C.sans,display:"flex",flexDirection:"column",color:C.text}}>

      {milestone && <MilestoneToast msg={milestone.msg} color={milestone.color} onDone={()=>setMilestone(null)} lang={lang}/>}

      {/* Progress bar */}
      <div style={{height:3,background:C.border,flexShrink:0,position:"relative",overflow:"hidden"}}>
        <div style={{height:"100%",width:`${(q/20)*100}%`,background:`linear-gradient(90deg, ${ch.color}, ${accent})`,transition:"width .4s cubic-bezier(.4,0,.2,1)",boxShadow:`0 0 8px ${ch.color}66`}}/>
      </div>

      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:`1px solid ${C.border}`,flexShrink:0,background:C.bg,position:"sticky",top:0,zIndex:5}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:ch.color,boxShadow:`0 0 8px ${ch.color}88`}}/>
          <span style={{fontFamily:C.mono,fontSize:10,color:ch.color,letterSpacing:".1em",fontWeight:600}}>{(S.chapters[ch.id]||"").toUpperCase()}</span>
          <span style={{fontFamily:C.mono,fontSize:9,color:C.muted,marginInlineStart:2}}>· {ch.family}</span>
        </div>
        <span style={{fontFamily:C.mono,fontSize:10,color:C.muted,letterSpacing:".05em"}}>{q} / 20</span>
        <div style={{display:"flex",alignItems:"center",gap:5}}>
          <div style={{display:"flex",gap:3,marginInlineEnd:6}}>
            {["A","B","C","D","E"].map(k=>(
              <div key={k} style={{width:5,height:5,borderRadius:"50%",background:fams[k]?C.green:C.subtle,transition:"background .4s",boxShadow:fams[k]?`0 0 6px ${C.green}aa`:"none"}}/>
            ))}
          </div>
          <span style={{fontFamily:C.mono,fontSize:9,color:conf>=75?C.green:C.muted,fontWeight:conf>=75?700:400,transition:"color .3s"}}>{conf}%</span>
        </div>
      </div>

      {/* Body */}
      <div style={{flex:1,overflow:"auto",padding:"16px 16px 100px"}}>
        <div style={{maxWidth:540,margin:"0 auto"}}>

          <div style={{marginBottom:24}}>
            <BrandPreview a={a} q={q} expanded={previewOpen} onToggle={()=>setPreviewOpen(p=>!p)} lang={lang}/>
          </div>

          <div style={{animation:"fadeIn .4s"}}>
            <div style={{fontFamily:C.mono,fontSize:10,color:C.muted,letterSpacing:".15em",marginBottom:12}}>Q{String(q).padStart(2,"0")}</div>
            <h2 style={{fontFamily:C.serif,fontSize:28,fontWeight:700,color:C.text,marginBottom:10,lineHeight:1.2,letterSpacing:"-.02em"}}>{meta.t}</h2>
            <p style={{fontSize:14,color:C.textDim,marginBottom:28,lineHeight:1.6}}>{meta.s}</p>
            {renderQ()}
          </div>
        </div>
      </div>

      {/* Nav */}
      <div style={{position:"sticky",bottom:0,borderTop:`1px solid ${C.border}`,background:`${C.bg}f0`,backdropFilter:"blur(12px)",padding:"14px 16px",display:"flex",gap:10,zIndex:10}}>
        <button onClick={back}
          style={{fontFamily:isRTL?C.sans:C.mono,fontSize:12,padding:"13px 18px",border:`1px solid ${C.border}`,background:"transparent",color:C.textDim,cursor:"pointer",borderRadius:10,letterSpacing:isRTL?"0":".04em",flexShrink:0,transition:"all .15s"}}>
          {S.btn_back}
        </button>
        <button onClick={advance}
          style={{flex:1,fontFamily:isRTL?C.sans:C.mono,fontSize:12,padding:"13px",border:"none",background:ch.color,color:"#000",cursor:"pointer",borderRadius:10,fontWeight:700,letterSpacing:isRTL?"0":".06em",boxShadow:`0 0 20px ${ch.color}55`,transition:"transform .12s"}}>
          {q===20?S.btn_build:S.btn_continue}
        </button>
      </div>
    </div>
  </>);
}
