//! 用一款最小的假遊戲測大廳與連線訊息：三個座位、開始時空位補電腦、每格把輸入加總。

use rand::rngs::SmallRng;
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use virtual_room::host::HostRoom;
use virtual_room::protocol::{drop_conn, handle, room_message, Conn};
use virtual_room::{Difficulty, Game, Lobby, RoomGame, SeatKind};

struct Toy;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
struct ToySettings {
    target: u32,
    difficulty: Difficulty,
}

#[derive(Default)]
struct ToyInput {
    bits: u32,
}

const CHARS: [&str; 3] = ["xiaocui", "aming", "leo"];

impl Game for Toy {
    type Settings = ToySettings;
    type SeatState = ToyInput;
    const SEATS: usize = 3;

    fn joined_text(name: &str, seat: usize) -> String {
        format!("{} 坐到了 {}P", name, seat + 1)
    }
    fn is_character(id: &str) -> bool {
        CHARS.contains(&id)
    }
    fn random_character(rng: &mut SmallRng, avoid: &[&str]) -> &'static str {
        let pool: Vec<&str> = CHARS.iter().copied().filter(|c| !avoid.contains(c)).collect();
        let pool = if pool.is_empty() { CHARS.to_vec() } else { pool };
        pool[rng.gen_range(0..pool.len())]
    }
    fn clamp_settings(s: ToySettings) -> ToySettings {
        ToySettings { target: s.target.clamp(1, 9), ..s }
    }
    fn seat_difficulty(s: &ToySettings) -> Difficulty {
        s.difficulty
    }
    fn on_disconnect(state: &mut ToyInput) {
        state.bits = 0;
    }
}

#[derive(Default)]
struct ToyRoom {
    lobby: Lobby<Toy>,
    total: Option<u32>,
    ended: bool,
}

impl RoomGame for ToyRoom {
    type Rules = Toy;
    fn lobby(&self) -> &Lobby<Toy> {
        &self.lobby
    }
    fn lobby_mut(&mut self) -> &mut Lobby<Toy> {
        &mut self.lobby
    }
    fn start(&mut self) -> Result<(), String> {
        for i in 0..Toy::SEATS {
            if self.lobby.seats[i].is_none() {
                self.lobby.add_bot(Some(i), self.lobby.settings.difficulty)?;
            }
        }
        self.total = Some(0);
        self.lobby.playing = true;
        self.lobby.sys("比賽開始！");
        Ok(())
    }
    fn reset_to_lobby(&mut self) {
        self.total = None;
        self.lobby.playing = false;
    }
    fn input(&mut self, seat: usize, msg: &Value) {
        if let Some(s) = self.lobby.seats[seat].as_mut() {
            s.state.bits = msg.get("b").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
        }
    }
    fn host_command(&mut self, cmd: &str, _msg: &Value) -> Option<Result<(), String>> {
        (cmd == "bonus").then(|| {
            self.total = self.total.map(|t| t + 100);
            Ok(())
        })
    }
    fn tick(&mut self) -> bool {
        let Some(total) = self.total.as_mut() else { return false };
        for s in self.lobby.seats.iter().flatten() {
            *total += if s.is_live_human() { s.state.bits } else { 1 };
        }
        if *total >= self.lobby.settings.target * 10 && !self.ended {
            self.ended = true;
            self.lobby.sys("結束！");
        }
        true
    }
    fn frame(&self) -> Option<Value> {
        self.total.map(|t| json!({ "total": t }))
    }
    fn just_ended(&mut self) -> bool {
        std::mem::take(&mut self.ended)
    }
}

#[test]
fn join_leave_bots_and_tokens() {
    let mut lobby: Lobby<Toy> = Lobby::new(ToySettings { target: 3, ..Default::default() });
    let (seat, token) = lobby.join("  悠太  ", Some("xiaocui")).unwrap();
    assert_eq!(seat, 0);
    assert_eq!(lobby.seats[0].as_ref().unwrap().name, "悠太");
    assert_eq!(lobby.seat_of_token(&token), Some(0));
    assert_eq!(lobby.seat_of_token(""), None);
    let (seat, _) = lobby.join("", Some("沒有這個人")).unwrap();
    assert_eq!(lobby.seats[seat].as_ref().unwrap().name, "玩家2", "沒取名就叫玩家N");
    assert!(Toy::is_character(&lobby.seats[seat].as_ref().unwrap().character), "不認得的角色就隨機挑");
    lobby.add_bot(None, Difficulty::Hard).unwrap();
    assert_eq!(lobby.seats[2].as_ref().unwrap().name, "電腦（困難）");
    assert_eq!(lobby.join("第四個", None).unwrap_err(), "座位已滿");
    assert_eq!(lobby.add_bot(Some(1), Difficulty::Easy).unwrap_err(), "這個座位有人了");
    lobby.remove_seat(1).unwrap();
    assert!(lobby.seats[1].is_none(), "大廳裡離開就空出座位");
    lobby.update_settings(ToySettings { target: 99, ..Default::default() });
    assert_eq!(lobby.settings.target, 9, "設定超出範圍會拉回來");
    let view = lobby.view(Some(0));
    assert_eq!(view["phase"], "lobby");
    assert_eq!(view["seats"][2]["kind"], "bot");
    assert_eq!(view["chat"][0]["text"], "悠太 坐到了 1P");
}

#[test]
fn leaving_during_a_match_hands_the_seat_to_a_bot() {
    let mut room = ToyRoom::default();
    let (seat, _) = room.lobby.join("悠太", None).unwrap();
    room.lobby.host_seat = Some(seat);
    room.start().unwrap();
    assert_eq!(room.lobby.join("晚到的人", None).unwrap_err(), "比賽進行中");
    assert_eq!(room.lobby.set_character(seat, "aming").unwrap_err(), "比賽進行中不能換角色");
    room.lobby.remove_seat(seat).unwrap();
    let s = room.lobby.seats[seat].as_ref().unwrap();
    assert_eq!(s.kind, SeatKind::Bot);
    assert_eq!(s.name, "電腦（代打 悠太）");
    assert_eq!(room.lobby.host_seat, None);
}

#[test]
fn protocol_host_guest_reconnect_and_game_commands() {
    let mut room = ToyRoom::default();
    let (mut host, mut guest) = (Conn::default(), Conn::default());
    let (r, changed) = handle(&mut room, "key", &mut host, &json!({"type": "hello", "name": "房主", "host_key": "key"}));
    assert!(changed && host.is_host && host.seat == Some(0));
    assert_eq!(r[0]["type"], "welcome");
    let (r, _) = handle(&mut room, "key", &mut guest, &json!({"type": "hello", "name": "客人", "host_key": "wrong"}));
    let token = r[0]["token"].as_str().unwrap().to_string();
    assert!(!guest.is_host && guest.seat == Some(1));
    // 觀眾
    let mut viewer = Conn::default();
    let (r, changed) = handle(&mut room, "key", &mut viewer, &json!({"type": "hello", "spectate": true}));
    assert!(!changed && viewer.seat.is_none() && r[0]["type"] == "welcome");
    // 不是房主不能下指令
    let (r, _) = handle(&mut room, "key", &mut guest, &json!({"type": "host", "cmd": "start"}));
    assert_eq!(r[0]["message"], "只有房主可以這樣做");
    let (r, _) = handle(&mut room, "key", &mut host, &json!({"type": "host", "cmd": "remove", "seat": 0}));
    assert_eq!(r[0]["message"], "不能移除這個座位");
    let (r, _) = handle(&mut room, "key", &mut host, &json!({"type": "host", "cmd": "settings", "settings": "壞掉"}));
    assert_eq!(r[0]["message"], "設定格式不對");
    let (r, _) = handle(&mut room, "key", &mut host, &json!({"type": "host", "cmd": "跳舞"}));
    assert_eq!(r[0]["message"], "不認得的指令");
    handle(&mut room, "key", &mut host, &json!({"type": "host", "cmd": "settings", "settings": {"target": 1}}));
    handle(&mut room, "key", &mut host, &json!({"type": "host", "cmd": "start"}));
    assert!(room.lobby.playing());
    assert_eq!(room.lobby.seats[2].as_ref().unwrap().kind, SeatKind::Bot, "開始時空位補電腦");
    // 比賽中觀眾按入席：失敗，先以觀眾身分進入
    let (r, _) = handle(&mut room, "key", &mut viewer, &json!({"type": "sit", "name": "觀眾"}));
    assert_eq!(r[0]["message"], "比賽進行中，先以觀眾身分進入");
    // 斷線再用 token 連回來：拿回原本的座位
    assert!(drop_conn(&mut room, &mut guest));
    assert!(!room.lobby.seats[1].as_ref().unwrap().connected);
    let mut back = Conn::default();
    handle(&mut room, "key", &mut back, &json!({"type": "hello", "token": token}));
    assert_eq!(back.seat, Some(1));
    assert_eq!(room_message(&room, &back)["state"]["you"], 1);
    // 輸入不回大廳資訊；遊戲自己的房主指令
    let (r, changed) = handle(&mut room, "key", &mut back, &json!({"type": "input", "b": 5}));
    assert!(r.is_empty() && !changed);
    let (r, changed) = handle(&mut room, "key", &mut host, &json!({"type": "host", "cmd": "bonus"}));
    assert!(r.is_empty() && changed);
    assert!(room.tick());
    assert_eq!(room.frame().unwrap()["total"], 100 + 0 + 5 + 1, "房主沒送輸入是 0、客人 5、電腦 1");
}

#[test]
fn host_room_routes_messages_frames_and_lobby_updates() {
    let mut host = HostRoom::new(ToyRoom::default(), "key");
    host.connect(0);
    host.connect(7);
    host.message(0, r#"{"type":"hello","name":"房主","host_key":"key"}"#);
    host.message(7, r#"{"type":"hello","name":"客人"}"#);
    let out: Value = serde_json::from_str(&host.drain()).unwrap();
    let out = out.as_array().unwrap();
    assert!(out.iter().any(|m| m["to"] == 7 && m["msg"]["type"] == "welcome"));
    assert!(out.iter().any(|m| m["to"] == 0 && m["msg"]["type"] == "room" && m["msg"]["state"]["is_host"] == true));
    assert_eq!(host.tick(), None, "還沒開始沒有影格");
    host.message(0, r#"{"type":"host","cmd":"settings","settings":{"target":1}}"#);
    host.message(0, r#"{"type":"host","cmd":"start"}"#);
    host.drain();
    let frame: Value = serde_json::from_str(&host.tick().unwrap()).unwrap();
    assert!(frame["total"].is_number());
    for _ in 0..20 {
        host.tick();
    }
    let out: Value = serde_json::from_str(&host.drain()).unwrap();
    assert!(out.as_array().unwrap().iter().any(|m| m["msg"]["type"] == "room"), "結束時大廳資訊（聊天）要更新");
    host.disconnect(7);
    assert!(!host.room.lobby.seats[1].as_ref().unwrap().connected);
}

/// 比賽在各自電腦上跑的遊戲（跑跑樂、音鬥樂）：斷線、離席都算棄權，不找電腦接手
#[derive(Default)]
struct RaceRoom {
    inner: ToyRoom,
    retired: Vec<usize>,
}

impl RoomGame for RaceRoom {
    type Rules = Toy;
    fn lobby(&self) -> &Lobby<Toy> {
        &self.inner.lobby
    }
    fn lobby_mut(&mut self) -> &mut Lobby<Toy> {
        &mut self.inner.lobby
    }
    fn start(&mut self) -> Result<(), String> {
        self.inner.start()
    }
    fn reset_to_lobby(&mut self) {
        self.inner.reset_to_lobby()
    }
    fn input(&mut self, seat: usize, msg: &Value) {
        self.inner.input(seat, msg)
    }
    fn tick(&mut self) -> bool {
        self.inner.tick()
    }
    fn frame(&self) -> Option<Value> {
        self.inner.frame()
    }
    fn just_ended(&mut self) -> bool {
        self.inner.just_ended()
    }
    fn disconnect(&mut self, seat: usize) {
        if let Some(s) = self.inner.lobby.seats[seat].as_mut() {
            s.connected = false;
        }
        self.retired.push(seat);
    }
    fn remove_seat(&mut self, seat: usize) -> Result<(), String> {
        self.retired.push(seat);
        self.inner.lobby.vacate(seat).map(|_| ())
    }
}

#[test]
fn games_can_retire_instead_of_handing_seats_to_bots() {
    let mut room = RaceRoom::default();
    let (mut host, mut guest, mut third) = (Conn::default(), Conn::default(), Conn::default());
    handle(&mut room, "key", &mut host, &json!({"type": "hello", "name": "房主", "host_key": "key"}));
    handle(&mut room, "key", &mut guest, &json!({"type": "hello", "name": "客人"}));
    handle(&mut room, "key", &mut third, &json!({"type": "hello", "name": "第三位"}));
    handle(&mut room, "key", &mut host, &json!({"type": "host", "cmd": "start"}));
    assert!(drop_conn(&mut room, &mut guest));
    let s = room.lobby().seats[1].as_ref().unwrap();
    assert!(s.kind == SeatKind::Human && !s.connected, "斷線不換成電腦");
    handle(&mut room, "key", &mut third, &json!({"type": "leave"}));
    assert!(room.lobby().seats[2].is_none(), "比賽中離席也直接空出座位");
    assert_eq!(room.retired, vec![1, 2]);
    let (_, changed) = handle(&mut room, "key", &mut host, &json!({"type": "host", "cmd": "remove", "seat": 1}));
    assert!(changed && room.lobby().seats[1].is_none(), "房主移除也走遊戲的 remove_seat");
    assert_eq!(room.lobby_mut().vacate(1).unwrap_err(), "這個座位沒有人");
}
