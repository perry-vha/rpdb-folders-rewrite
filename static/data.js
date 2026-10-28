/* Static value lists used by the UI. Names are generated with Intl.DisplayNames. */
const LANG_CODES = 'aa ab af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu'.split(' ');
const LANG_EXTRA = ['pt-BR', 'pt-PT', 'es-MX', 'es-ES', 'zh-TW', 'zh-CN', 'fr-CA'];

const LOCALES = 'af_ZA ar_AE ar_EG ar_SA az_AZ be_BY bg_BG bn_BD bs_BA ca_ES cs_CZ cy_GB da_DK de_AT de_CH de_DE el_GR en_AU en_CA en_GB en_IE en_IN en_NZ en_US en_ZA es_AR es_CL es_CO es_ES es_MX es_PE es_VE et_EE eu_ES fa_IR fi_FI fil_PH fr_BE fr_CA fr_CH fr_FR ga_IE gl_ES gu_IN he_IL hi_IN hr_HR hu_HU hy_AM id_ID is_IS it_CH it_IT ja_JP ka_GE kk_KZ km_KH kn_IN ko_KR lt_LT lv_LV mk_MK ml_IN mn_MN mr_IN ms_MY mt_MT nb_NO ne_NP nl_BE nl_NL nn_NO pa_IN pl_PL pt_BR pt_PT ro_RO ru_RU sk_SK sl_SI sq_AL sr_RS sv_FI sv_SE sw_KE ta_IN te_IN th_TH tr_TR uk_UA ur_PK uz_UZ vi_VN zh_CN zh_HK zh_TW zu_ZA'.split(' ');

const COLORS = 'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkturquoise darkviolet deeppink deepskyblue dimgray dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightpink lightsalmon lightseagreen lightskyblue lightslategray lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(' ');

const RATING_SOURCES = ['imdb', 'tmdb', 'trakt', 'letterboxd', 'tomatoes-critics', 'tomatoes-audience', 'metacritic-critics', 'metacritic-audience', 'myanimelist', 'commonsense', 'rogerebert', 'mdblist', 'overall-rating', 'critics-rating', 'audience-rating', 'us-age'];

const POSTER_TYPES = [
  ['poster-default', 'With Ratings (default)'],
  ['poster-certs', 'With Ratings + Certifications'],
  ['poster-rt', 'With Rotten Tomatoes + Audience Ratings'],
  ['poster-mc', 'With Metacritic + Audience Ratings'],
  ['rating-order', 'Choose Rating Order (Tier 2+)'],
];

const BADGE_CATEGORIES = {
  'Original Video Spoken Language': ['auto_lang', 'auto_lang_no_en'],
  'Automated Age Rating': ['commonsense', 'commonsensegold'],
  'Automated US Age Rating': ['us_age_rating', 'us_age_rating_gold'],
  'Video Quality': ['4k', '4kupscaled', '8k', '5k', '2k', '1080p', '720p', '576p', '480p', '360p', '240p'],
  '3D': ['3d'],
  'Color Range': ['hdrcolor', 'hdr', 'dolbyvision', 'dolbyvisioncolor', 'dolbyvisioncoloralt'],
  'Aspect Ratio': ['imaxgold', 'imax'],
  'Video Source': ['remuxgold', 'remux', 'bluray', 'dvd', 'web'],
  'Video Codec': ['h264', 'h265'],
  'Video Container': ['mkv', 'mp4', 'avi'],
  Audio: ['audio20', 'audio51', 'audio71', 'dd20', 'dd51', 'ddp20', 'ddp51', 'truehd51lossless', 'truehd51surround', 'truehd71lossless', 'truehd71surround', 'pcm51lossless', 'pcm51surround', 'pcm71lossless', 'pcm71surround', 'atmos3dsound', 'atmossurround'],
  'Personal Rating': ['5stars', '4stars', '3stars', '2stars', '1stars'],
};

const BADGE_POSITIONS = ['left', 'center', 'right', 'bottom|left', 'bottom|center', 'bottom|right'];
const BACKDROP_BADGE_POSITIONS = ['right-bottom', 'right-top', 'right-center', 'left-bottom', 'left-top', 'left-center', 'center-bottom', 'center-top'];

const THEMES = ['default', 'blocks', 'rounded-blocks', 'sharp-blocks', 'boxes', 'stripes-right', 'stripes-left'];
const LIGHT_THEMES = ['light-bar', 'light-blocks', 'light-rounded-blocks', 'light-sharp-blocks', 'light-boxes', 'light-stripes-right', 'light-stripes-left'];
const POSTER_BAR_POS = ['bottom', 'top', 'left-top', 'left-center', 'left-bottom', 'right-top', 'right-center', 'right-bottom'];
const BACKDROP_BAR_POS = ['right-top', 'right-center', 'right-bottom', 'left-top', 'left-center', 'left-bottom'];
const LOGO_BAR_POS = [...POSTER_BAR_POS, 'bottom-left', 'bottom-right', 'top-left', 'top-right'];

const range = (a, b, step, dec = 0) => { const o = []; for (let v = a; v <= b + 1e-9; v += step) o.push(Number(v.toFixed(dec))); return o; };
