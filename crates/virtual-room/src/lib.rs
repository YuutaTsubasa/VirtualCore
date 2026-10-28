//! Virtual 系列共用的連線房間（不碰網路，可以編成 WebAssembly）：
//! - `lobby`：座位（真人或電腦）、房主、聊天、入席／離席／斷線
//! - `protocol`：連線訊息（hello、sit、input、chat、host…）的處理
//! - `host`：線上房間的房主（瀏覽器就是伺服器）要的連線表與送出佇列
//!
//! 每款遊戲提供兩樣東西：
//! - 實作 [`Game`] 的規則型別：座位數、提示文字、角色、設定
//! - 實作 [`RoomGame`] 的房間：裡面放一個 [`Lobby`] 加上自己的比賽狀態（開始、每格前進、輸入）
//!
//! 區網伺服器在另一個 crate `virtual-lan`。

pub mod host;
pub mod lobby;
pub mod protocol;

pub use lobby::{ChatLine, Lobby, Seat, SeatKind};

use rand::rngs::SmallRng;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 電腦玩家的強度
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Difficulty {
    Easy,
    #[default]
    Normal,
    Hard,
}

impl Difficulty {
    pub fn label(self) -> &'static str {
        match self {
            Difficulty::Easy => "簡單",
            Difficulty::Normal => "普通",
            Difficulty::Hard => "困難",
        }
    }
}

/// 一款遊戲的房間規則（只有型別與純函式，沒有狀態）
pub trait Game: 'static {
    /// 房主可以調的設定（大廳的「本局規則」）
    type Settings: Serialize + DeserializeOwned + Clone + Default;
    /// 每個座位遊戲自己要記的東西（例如輸入）；入席時用 Default 建立
    type SeatState: Default;

    /// 座位數
    const SEATS: usize;

    /// 有人入席時的系統訊息，例如「小翠 坐到了左邊」
    fn joined_text(name: &str, seat: usize) -> String;
    /// 電腦玩家的名字，例如「電腦（普通）」
    fn bot_name(difficulty: Difficulty) -> String {
        format!("電腦（{}）", difficulty.label())
    }
    fn is_character(id: &str) -> bool;
    /// 隨機挑一個角色（盡量避開 avoid 裡已經有人選的）
    fn random_character(rng: &mut SmallRng, avoid: &[&str]) -> &'static str;
    /// 房主改設定時，把超出範圍的值拉回來
    fn clamp_settings(settings: Self::Settings) -> Self::Settings {
        settings
    }
    /// 真人座位斷線後由電腦代打時用的強度
    fn seat_difficulty(settings: &Self::Settings) -> Difficulty;
    /// 斷線時清掉這個座位的輸入（免得一直往同一個方向跑）
    fn on_disconnect(_state: &mut Self::SeatState) {}
}

/// 一款遊戲的房間：大廳是共用的 [`Lobby`]，比賽是遊戲自己的
pub trait RoomGame {
    type Rules: Game;

    fn lobby(&self) -> &Lobby<Self::Rules>;
    fn lobby_mut(&mut self) -> &mut Lobby<Self::Rules>;

    /// 房主按「開始」。成功時要把 `lobby.playing` 設成 true。
    fn start(&mut self) -> Result<(), String>;
    /// 回大廳。要把 `lobby.playing` 設成 false。
    fn reset_to_lobby(&mut self);
    /// 玩家的輸入訊息（`input_type()` 那種訊息）
    fn input(&mut self, seat: usize, msg: &Value);
    /// 有人斷線（座位留著，帶 token 回來可以拿回）。預設是大廳的：比賽中由電腦代打。
    /// 比賽在各自電腦上跑的遊戲（跑跑樂、音鬥樂）電腦接不了手，改成這一場算棄權。
    fn disconnect(&mut self, seat: usize) {
        self.lobby_mut().disconnect(seat);
    }
    /// 有人離席（自己離開或房主移除）。預設是大廳的：比賽中換成電腦接手。
    fn remove_seat(&mut self, seat: usize) -> Result<(), String> {
        self.lobby_mut().remove_seat(seat)
    }
    /// 遊戲自己的房主指令（例如接關、下一關）；不認得就回 None
    fn host_command(&mut self, _cmd: &str, _msg: &Value) -> Option<Result<(), String>> {
        None
    }
    /// 前進一個影格；這一格要廣播比賽畫面就回傳 true
    fn tick(&mut self) -> bool;
    /// 比賽畫面（每格或每幾格送一次）
    fn frame(&self) -> Option<Value>;
    /// 這一格有沒有要讓大廳資訊更新的事（例如比賽結束、過關，聊天多了系統訊息）
    fn just_ended(&mut self) -> bool;
    /// 給這條連線的大廳資訊；預設就是大廳的座位、聊天、設定
    fn view(&self, you: Option<usize>) -> Value {
        self.lobby().view(you)
    }
    /// 玩家輸入的訊息種類（大部分是 input；跑跑樂、音鬥樂是 progress）
    fn input_type() -> &'static str {
        "input"
    }
}
