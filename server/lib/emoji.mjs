/* ==========================================================================
   server/lib/emoji.mjs · :shortcode: → emoji
   ---------------------------------------------------------------------------
   一份**常用**表，不是 GitHub 那 1800 个的全量。名字按 GitHub 的叫法来
   （:smile: :heart: :tada: …），认不出来的一律原样留着，不乱吃字符。

   为什么只挑常用：全量表会让这个文件变成一大坨别人的数据，而真正会手打的
   就那么几十个；要更全，把这里的表加长即可——格式就是 `名字: '字'`。
   页面上直接改字时用的是工具条里那个 emoji 面板，不走短代码。
   ========================================================================== */

import { mapText } from './htmltext.mjs';

export const EMOJI = {
  /* 脸 */
  smile: '😄', grinning: '😀', grin: '😁', joy: '😂', rofl: '🤣', laughing: '😆',
  sweat_smile: '😅', smiley: '😃', wink: '😉', blush: '😊', innocent: '😇', heart_eyes: '😍',
  kissing_heart: '😘', yum: '😋', stuck_out_tongue: '😛', zany_face: '🤪', thinking: '🤔',
  neutral_face: '😐', expressionless: '😑', no_mouth: '😶', smirk: '😏', unamused: '😒',
  roll_eyes: '🙄', grimacing: '😬', relieved: '😌', pensive: '😔', sleepy: '😪', sleeping: '😴',
  mask: '😷', nauseated_face: '🤢', sneezing_face: '🤧', hot_face: '🥵', cold_face: '🥶',
  dizzy_face: '😵', exploding_head: '🤯', cowboy_hat_face: '🤠', sunglasses: '😎',
  nerd_face: '🤓', monocle_face: '🧐', confused: '😕', worried: '😟', cry: '😢', sob: '😭',
  frowning: '😦', anguished: '😧', fearful: '😨', cold_sweat: '😰', disappointed: '😞',
  sweat: '😓', weary: '😩', tired_face: '😫', triumph: '😤', rage: '😡', angry: '😠',
  cursing_face: '🤬', scream: '😱', flushed: '😳', pleading_face: '🥺', yawning_face: '🥱',
  lying_face: '🤥', shushing_face: '🤫', hugging_face: '🤗', shrug: '🤷', facepalm: '🤦',
  /* 手与身体 */
  '+1': '👍', thumbsup: '👍', '-1': '👎', thumbsdown: '👎', ok_hand: '👌', pinched_fingers: '🤌',
  v: '✌️', crossed_fingers: '🤞', love_you_gesture: '🤟', metal: '🤘', call_me_hand: '🤙',
  point_left: '👈', point_right: '👉', point_up: '☝️', point_down: '👇', raised_hand: '✋',
  wave: '👋', clap: '👏', raised_hands: '🙌', open_hands: '👐', pray: '🙏', handshake: '🤝',
  muscle: '💪', writing_hand: '✍️', nail_care: '💅', eyes: '👀', eye: '👁️', brain: '🧠',
  /* 心与符号 */
  heart: '❤️', orange_heart: '🧡', yellow_heart: '💛', green_heart: '💚', blue_heart: '💙',
  purple_heart: '💜', black_heart: '🖤', white_heart: '🤍', brown_heart: '🤎', broken_heart: '💔',
  sparkling_heart: '💖', heartpulse: '💗', heartbeat: '💓', cupid: '💘', two_hearts: '💕',
  star: '⭐', star2: '🌟', sparkles: '✨', zap: '⚡', boom: '💥', fire: '🔥', droplet: '💧',
  snowflake: '❄️', rainbow: '🌈', sun_with_face: '🌞', crescent_moon: '🌙', cloud: '☁️',
  check: '✔️', white_check_mark: '✅', heavy_check_mark: '✔️', x: '❌', warning: '⚠️',
  question: '❓', exclamation: '❗', bulb: '💡', mag: '🔍', lock: '🔒', unlock: '🔓', key: '🔑',
  bell: '🔔', no_bell: '🔕', bookmark: '🔖', link: '🔗', paperclip: '📎', pushpin: '📌',
  scissors: '✂️', wrench: '🔧', hammer: '🔨', gear: '⚙️', toolbox: '🧰', shield: '🛡️',
  /* 书写与办公 */
  memo: '📝', pencil2: '✏️', page_facing_up: '📄', page_with_curl: '📃', bookmark_tabs: '📑',
  clipboard: '📋', file_folder: '📁', open_file_folder: '📂', books: '📚', book: '📖',
  notebook: '📓', newspaper: '📰', calendar: '📅', date: '📆', chart_with_upwards_trend: '📈',
  chart_with_downwards_trend: '📉', bar_chart: '📊', envelope: '✉️', email: '📧', inbox_tray: '📥',
  outbox_tray: '📤', package: '📦', computer: '💻', desktop_computer: '🖥️', keyboard: '⌨️',
  printer: '🖨️', floppy_disk: '💾', cd: '💿', battery: '🔋', electric_plug: '🔌', satellite: '📡',
  /* 声音与影像 */
  musical_note: '🎵', notes: '🎶', headphones: '🎧', microphone: '🎤', studio_microphone: '🎙️',
  guitar: '🎸', violin: '🎻', piano: '🎹', drum: '🥁', saxophone: '🎷', trumpet: '🎺',
  movie_camera: '🎥', video_camera: '📹', camera: '📷', clapper: '🎬', tv: '📺', radio: '📻',
  art: '🎨', frame_photo: '🖼️', pencil_art: '🖌️', game_die: '🎲', video_game: '🎮',
  /* 生活 */
  coffee: '☕', tea: '🍵', beer: '🍺', beers: '🍻', wine_glass: '🍷', cocktail: '🍸',
  milk_glass: '🥛', pizza: '🍕', hamburger: '🍔', fries: '🍟', ramen: '🍜', sushi: '🍣',
  bento: '🍱', rice: '🍚', rice_ball: '🍙', dumpling: '🥟', cake: '🍰', birthday: '🎂',
  cookie: '🍪', chocolate_bar: '🍫', candy: '🍬', icecream: '🍦', shaved_ice: '🍧',
  apple: '🍎', green_apple: '🍏', tangerine: '🍊', lemon: '🍋', watermelon: '🍉', grapes: '🍇',
  strawberry: '🍓', peach: '🍑', cherry_blossom: '🌸', cherry: '🍒', corn: '🌽', hot_pepper: '🌶️',
  /* 动物与自然 */
  cat: '🐱', smiley_cat: '😺', dog: '🐶', panda_face: '🐼', bear: '🐻', fox_face: '🦊',
  rabbit: '🐰', mouse: '🐭', hamster: '🐹', monkey_face: '🐵', penguin: '🐧', bird: '🐦',
  baby_chick: '🐤', whale: '🐳', dolphin: '🐬', fish: '🐟', octopus: '🐙', crab: '🦀',
  bug: '🐛', bee: '🐝', butterfly: '🦋', snail: '🐌', turtle: '🐢', snake: '🐍',
  dragon: '🐉', unicorn: '🦄', seedling: '🌱', four_leaf_clover: '🍀', maple_leaf: '🍁',
  fallen_leaf: '🍂', leaves: '🍃', cactus: '🌵', palm_tree: '🌴', evergreen_tree: '🌲',
  /* 交通与地点 */
  rocket: '🚀', airplane: '✈️', helicopter: '🚁', steam_locomotive: '🚂', bullettrain_side: '🚄',
  metro: '🚇', car: '🚗', taxi: '🚕', bus: '🚌', bike: '🚲', motor_scooter: '🛵',
  ship: '🚢', speedboat: '🚤', anchor: '⚓', world_map: '🗺️', house: '🏠', office: '🏢',
  tent: '⛺', mountain: '⛰️', mount_fuji: '🗻', beach_umbrella: '🏖️', city_sunset: '🌇',
  /* 标志与节日 */
  tada: '🎉', confetti_ball: '🎊', balloon: '🎈', gift: '🎁', christmas_tree: '🎄',
  jack_o_lantern: '🎃', firework: '🎆', sparkler: '🎇', trophy: '🏆', medal_sports: '🏅',
  first_place_medal: '🥇', second_place_medal: '🥈', third_place_medal: '🥉', dart: '🎯',
  soccer: '⚽', basketball: '🏀', tennis: '🎾', badminton: '🏸', ping_pong: '🏓', chess_pawn: '♟️',
  eight_ball: '🎱', dice: '🎲', crown: '👑', ring: '💍', gem: '💎', moneybag: '💰',
  wrench_and_hammer: '🛠️', label: '🏷️', speech_balloon: '💬', thought_balloon: '💭',
  hundred: '💯', hankey: '💩', ghost: '👻', alien: '👽', robot_face: '🤖', skull: '💀',
  jack_o_lantern_alt: '🎃', crystal_ball: '🔮', hourglass: '⌛', alarm_clock: '⏰',
  hourglass_flowing_sand: '⏳', watch: '⌚', thermometer: '🌡️', umbrella: '☔',
};

const SHORTCODE_RE = /:([a-z0-9_+-]+):/g;

/* 只在文本节点里换；code / pre 里保持原样。
   认不出来的短代码原样留着（`:这不是emoji:` 不会被吃掉）。 */
export function decorateEmoji(html) {
  return mapText(html, (text) => (
    text.indexOf(':') < 0 ? text : text.replace(SHORTCODE_RE, (whole, name) => EMOJI[name] || whole)
  ));
}

/* 给工具条那个 emoji 面板用：一份常用的小名单，客户端直接拿走 */
export const PICKER = [
  '😄', '😁', '😂', '🤣', '😊', '😍', '😘', '😎',
  '🤔', '🙄', '😴', '🥺', '😭', '😱', '😤', '🤯',
  '👍', '👎', '👌', '✌️', '🙏', '👏', '🙌', '🤝',
  '💪', '👀', '🧠', '✍️', '❤️', '💔', '💖', '✨',
  '🔥', '⭐', '🎉', '🎁', '🏆', '✅', '❌', '⚠️',
  '💡', '📌', '📝', '📚', '💻', '🐛', '🔧', '🔍',
  '🎵', '🎧', '🎸', '🎹', '🎬', '📷', '🎨', '🎮',
  '☕', '🍰', '🍜', '🍣', '🌸', '🍀', '🌙', '☁️',
  '🚀', '✈️', '🚲', '🏠', '🐱', '🐼', '🦊', '🐳',
];
