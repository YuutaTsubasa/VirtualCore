//! 大廳：座位（真人或電腦）、房主、觀戰者、聊天。比賽本身由遊戲的房間處理。

use crate::{Difficulty, Game};
use rand::distributions::Alphanumeric;
use rand::rngs::SmallRng;
use rand::{Rng, SeedableRng};
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SeatKind {
    Human,
    Bot,
}

pub struct Seat<S> {
    pub name: String,
    pub character: String,
    pub kind: SeatKind,
    pub difficulty: Difficulty,
    pub token: String,
    pub connected: bool,
    /// 遊戲自己要記的東西（例如輸入）
    pub state: S,
}

impl<S> Seat<S> {
    /// 真人而且連線中（否則由電腦操作）
    pub fn is_live_human(&self) -> bool {
        self.kind == SeatKind::Human && self.connected
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ChatLine {
    seat: Option<usize>,
    name: String,
    text: String,
    sys: bool,
}

const MAX_CHAT: usize = 60;

pub struct Lobby<G: Game> {
    pub seats: Vec<Option<Seat<G::SeatState>>>,
    pub host_seat: Option<usize>,
    pub settings: G::Settings,
    /// 比賽中（由遊戲的 start／reset_to_lobby 設定）
    pub playing: bool,
    chat: Vec<ChatLine>,
    pub rng: SmallRng,
}

impl<G: Game> Default for Lobby<G> {
    fn default() -> Self {
        Self::new(G::Settings::default())
    }
}

impl<G: Game> Lobby<G> {
    pub fn new(settings: G::Settings) -> Self {
        Lobby {
            seats: (0..G::SEATS).map(|_| None).collect(),
            host_seat: None,
            settings,
            playing: false,
            chat: Vec::new(),
            rng: SmallRng::from_entropy(),
        }
    }

    pub fn playing(&self) -> bool {
        self.playing
    }

    /// 系統訊息（聊天裡的灰字）
    pub fn sys(&mut self, text: impl Into<String>) {
        self.chat.push(ChatLine { seat: None, name: String::new(), text: text.into(), sys: true });
        if self.chat.len() > MAX_CHAT {
            self.chat.remove(0);
        }
    }

    pub fn push_chat(&mut self, seat: Option<usize>, text: &str) {
        let text: String = text.trim().chars().take(300).collect();
        if text.is_empty() {
            return;
        }
        let name = seat
            .and_then(|s| self.seats[s].as_ref())
            .map(|s| s.name.clone())
            .unwrap_or_else(|| "觀眾".into());
        self.chat.push(ChatLine { seat, name, text, sys: false });
        if self.chat.len() > MAX_CHAT {
            self.chat.remove(0);
        }
    }

    fn pick_character(&mut self, wanted: Option<&str>) -> String {
        match wanted {
            Some(c) if G::is_character(c) => c.to_string(),
            _ => G::random_character(&mut self.rng, &[]).to_string(),
        }
    }

    /// 真人入席，回傳（座位, 重新連線用的 token）。比賽中不能入席（改成觀戰）。
    pub fn join(&mut self, name: &str, character: Option<&str>) -> Result<(usize, String), String> {
        if self.playing {
            return Err("比賽進行中".into());
        }
        let seat = self.seats.iter().position(|s| s.is_none()).ok_or("座位已滿")?;
        let name: String = name.trim().chars().take(16).collect();
        let name = if name.is_empty() { format!("玩家{}", seat + 1) } else { name };
        let token: String = (&mut self.rng).sample_iter(&Alphanumeric).take(24).map(char::from).collect();
        let character = self.pick_character(character);
        self.sys(G::joined_text(&name, seat));
        self.seats[seat] = Some(Seat {
            name,
            character,
            kind: SeatKind::Human,
            difficulty: G::seat_difficulty(&self.settings),
            token: token.clone(),
            connected: false,
            state: G::SeatState::default(),
        });
        Ok((seat, token))
    }

    pub fn seat_of_token(&self, token: &str) -> Option<usize> {
        if token.is_empty() {
            return None;
        }
        self.seats
            .iter()
            .position(|s| s.as_ref().is_some_and(|s| s.kind == SeatKind::Human && s.token == token))
    }

    pub fn connect(&mut self, seat: usize) {
        if let Some(s) = self.seats[seat].as_mut() {
            s.connected = true;
        }
    }

    /// 斷線：比賽中由電腦代打，重新連上就還給玩家
    pub fn disconnect(&mut self, seat: usize) {
        let Some(s) = self.seats[seat].as_mut() else { return };
        s.connected = false;
        G::on_disconnect(&mut s.state);
        let name = s.name.clone();
        if self.playing {
            self.sys(format!("{} 斷線了，先由電腦代打", name));
        }
    }

    pub fn add_bot(&mut self, seat: Option<usize>, difficulty: Difficulty) -> Result<usize, String> {
        if self.playing {
            return Err("比賽進行中".into());
        }
        let seat = match seat {
            Some(s) if s < G::SEATS && self.seats[s].is_none() => s,
            Some(_) => return Err("這個座位有人了".into()),
            None => self.seats.iter().position(|s| s.is_none()).ok_or("座位已滿")?,
        };
        let taken: Vec<String> = self.seats.iter().flatten().map(|s| s.character.clone()).collect();
        let taken: Vec<&str> = taken.iter().map(|s| s.as_str()).collect();
        let character = G::random_character(&mut self.rng, &taken).to_string();
        self.seats[seat] = Some(Seat {
            name: G::bot_name(difficulty),
            character,
            kind: SeatKind::Bot,
            difficulty,
            token: String::new(),
            connected: true,
            state: G::SeatState::default(),
        });
        Ok(seat)
    }

    /// 離開座位（玩家自己離開或房主移除）。比賽中就換成電腦接手。
    pub fn remove_seat(&mut self, seat: usize) -> Result<(), String> {
        let playing = self.playing;
        let Some(s) = self.seats.get_mut(seat).and_then(|s| s.as_mut()) else {
            return Err("這個座位沒有人".into());
        };
        let name = s.name.clone();
        if playing {
            s.kind = SeatKind::Bot;
            s.token.clear();
            s.connected = true;
            s.name = format!("電腦（代打 {}）", name);
        } else {
            self.seats[seat] = None;
        }
        if self.host_seat == Some(seat) {
            self.host_seat = None;
        }
        self.sys(format!("{} 離開了座位", name));
        Ok(())
    }

    pub fn set_character(&mut self, seat: usize, id: &str) -> Result<(), String> {
        if self.playing {
            return Err("比賽進行中不能換角色".into());
        }
        if !G::is_character(id) {
            return Err("沒有這個角色".into());
        }
        let s = self.seats[seat].as_mut().ok_or("你沒有座位")?;
        s.character = id.to_string();
        Ok(())
    }

    pub fn update_settings(&mut self, settings: G::Settings) {
        self.settings = G::clamp_settings(settings);
    }

    /// 大廳／房間資訊（有變動時送）
    pub fn view(&self, you: Option<usize>) -> Value {
        let seats: Vec<Value> = self
            .seats
            .iter()
            .map(|s| {
                s.as_ref().map_or(Value::Null, |s| {
                    json!({
                        "name": s.name,
                        "character": s.character,
                        "kind": s.kind,
                        "difficulty": s.difficulty,
                        "connected": s.connected,
                    })
                })
            })
            .collect();
        json!({
            "phase": if self.playing { "playing" } else { "lobby" },
            "seats": seats,
            "host_seat": self.host_seat,
            "you": you,
            "settings": self.settings,
            "chat": self.chat,
        })
    }
}
