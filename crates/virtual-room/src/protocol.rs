//! 連線訊息（JSON）的處理：hello、sit、input、character、chat、leave、host 指令，
//! 回覆 welcome、error、room、frame。區網伺服器（virtual-lan，WebSocket）與線上房間的房主瀏覽器
//! （各遊戲的 *-wasm，WebRTC）共用這一份，所以兩種房間的行為一模一樣。

use crate::{Difficulty, Game, RoomGame};
use serde_json::{json, Value};

/// 一條連線（一個玩家或觀眾）
#[derive(Default)]
pub struct Conn {
    pub seat: Option<usize>,
    pub is_host: bool,
    /// 送過 hello 了（之後才收得到大廳資訊與影格）
    pub hello: bool,
}

pub fn err(msg: impl Into<String>) -> Value {
    json!({"type": "error", "message": msg.into()})
}

fn welcome(conn: &Conn, token: Option<&str>) -> Value {
    json!({"type": "welcome", "seat": conn.seat, "token": token, "is_host": conn.is_host})
}

/// 給這條連線的大廳資訊
pub fn room_message<R: RoomGame>(room: &R, conn: &Conn) -> Value {
    let mut view = room.view(conn.seat);
    view["is_host"] = json!(conn.is_host);
    json!({"type": "room", "state": view})
}

/// 比賽影格的訊息
pub fn frame_message(state: &Value) -> Value {
    json!({"type": "frame", "state": state})
}

/// 連線中斷：比賽中由電腦代打
pub fn drop_conn<R: RoomGame>(room: &mut R, conn: &mut Conn) -> bool {
    match conn.seat.take() {
        Some(s) => {
            room.lobby_mut().disconnect(s);
            true
        }
        None => false,
    }
}

/// 這則訊息之後要不要回一份大廳資訊（輸入每秒好幾十次，不用每次都回）
pub fn wants_room<R: RoomGame>(msg: &Value) -> bool {
    msg.get("type").and_then(|x| x.as_str()) != Some(R::input_type())
}

/// 處理一則訊息，回傳（要回給這條連線的訊息, 大廳資訊有沒有變）
pub fn handle<R: RoomGame>(room: &mut R, host_key: &str, conn: &mut Conn, v: &Value) -> (Vec<Value>, bool) {
    let ty = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
    let str_of = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("");
    if ty == R::input_type() {
        if let Some(s) = conn.seat {
            room.input(s, v);
        }
        return (vec![], false);
    }
    match ty {
        "hello" => {
            conn.hello = true;
            if let Some(k) = v.get("host_key").and_then(|x| x.as_str()) {
                conn.is_host = !k.is_empty() && k == host_key;
            }
            if let Some(s) = conn.seat.take() {
                room.lobby_mut().disconnect(s);
            }
            // 帶著 token 回來：拿回原本的座位
            let token = str_of("token");
            if let Some(s) = room.lobby().seat_of_token(token) {
                conn.seat = Some(s);
                room.lobby_mut().connect(s);
                if conn.is_host {
                    room.lobby_mut().host_seat = Some(s);
                }
                return (vec![welcome(conn, Some(token))], true);
            }
            if v.get("spectate").and_then(|x| x.as_bool()).unwrap_or(false) {
                return (vec![welcome(conn, None)], false);
            }
            sit(room, conn, str_of("name"), v.get("character").and_then(|x| x.as_str()))
        }
        // 觀眾在大廳按「入席」
        "sit" => {
            if conn.seat.is_some() {
                return (vec![], false);
            }
            sit(room, conn, str_of("name"), v.get("character").and_then(|x| x.as_str()))
        }
        "character" => {
            let Some(s) = conn.seat else { return (vec![err("你沒有座位")], false) };
            match room.lobby_mut().set_character(s, str_of("id")) {
                Ok(()) => (vec![], true),
                Err(e) => (vec![err(e)], false),
            }
        }
        "chat" => {
            room.lobby_mut().push_chat(conn.seat, str_of("text"));
            (vec![], true)
        }
        "leave" => {
            if let Some(s) = conn.seat.take() {
                let _ = room.lobby_mut().remove_seat(s);
            }
            (vec![welcome(conn, None)], true)
        }
        "host" => {
            if !conn.is_host {
                return (vec![err("只有房主可以這樣做")], false);
            }
            let seats = <R::Rules as Game>::SEATS;
            let seat = v.get("seat").and_then(|x| x.as_u64()).map(|s| s as usize).filter(|s| *s < seats);
            let cmd = str_of("cmd");
            let result = match cmd {
                "add_bot" => {
                    let d: Difficulty = v.get("difficulty").and_then(|d| serde_json::from_value(d.clone()).ok()).unwrap_or_default();
                    room.lobby_mut().add_bot(seat, d).map(|_| ())
                }
                "remove" => match seat {
                    Some(s) if Some(s) != room.lobby().host_seat => room.lobby_mut().remove_seat(s),
                    _ => Err("不能移除這個座位".into()),
                },
                "settings" => {
                    match v.get("settings").and_then(|s| serde_json::from_value::<<R::Rules as Game>::Settings>(s.clone()).ok()) {
                        Some(s) => {
                            room.lobby_mut().update_settings(s);
                            Ok(())
                        }
                        None => Err("設定格式不對".into()),
                    }
                }
                "start" => room.start(),
                "reset" => {
                    room.reset_to_lobby();
                    Ok(())
                }
                _ => room.host_command(cmd, v).unwrap_or_else(|| Err("不認得的指令".into())),
            };
            match result {
                Ok(()) => (vec![], true),
                Err(e) => (vec![err(e)], false),
            }
        }
        _ => (vec![], false),
    }
}

fn sit<R: RoomGame>(room: &mut R, conn: &mut Conn, name: &str, character: Option<&str>) -> (Vec<Value>, bool) {
    match room.lobby_mut().join(name, character) {
        Ok((s, token)) => {
            conn.seat = Some(s);
            room.lobby_mut().connect(s);
            if conn.is_host {
                room.lobby_mut().host_seat = Some(s);
            }
            (vec![welcome(conn, Some(&token))], true)
        }
        Err(e) => (vec![err(format!("{}，先以觀眾身分進入", e)), welcome(conn, None)], true),
    }
}
