//! 線上房間的房主：跟區網伺服器一樣的房間與訊息，只是不碰網路。
//! 連線用數字 id（0 是房主自己），收到的 JSON 交給 `message()`，
//! 每格呼叫 `tick()` 拿影格，再用 `drain()` 拿要送給各連線的訊息。
//! 各遊戲的 *-wasm 用 wasm_bindgen 包一層（wasm_bindgen 不能直接匯出泛型）。

use crate::protocol::{self, Conn};
use crate::RoomGame;
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub struct HostRoom<R: RoomGame> {
    pub room: R,
    host_key: String,
    conns: BTreeMap<u32, Conn>,
    outbox: Vec<Value>,
    /// 大廳資訊有變，下次 drain() 要送給每個人
    dirty: bool,
}

impl<R: RoomGame> HostRoom<R> {
    pub fn new(room: R, host_key: &str) -> Self {
        HostRoom { room, host_key: host_key.into(), conns: BTreeMap::new(), outbox: Vec::new(), dirty: false }
    }

    pub fn connect(&mut self, id: u32) {
        self.conns.insert(id, Conn::default());
    }

    /// 連線中斷：比賽中由電腦代打，拿 token 重新連上就還給玩家
    pub fn disconnect(&mut self, id: u32) {
        if let Some(mut conn) = self.conns.remove(&id) {
            self.dirty |= protocol::drop_conn(&mut self.room, &mut conn);
        }
    }

    /// 收到 id 傳來的一則訊息（JSON 文字）
    pub fn message(&mut self, id: u32, text: &str) {
        let Some(conn) = self.conns.get_mut(&id) else { return };
        let v: Value = serde_json::from_str(text).unwrap_or(Value::Null);
        let (replies, changed) = protocol::handle(&mut self.room, &self.host_key, conn, &v);
        for r in replies {
            self.outbox.push(json!({"to": id, "msg": r}));
        }
        self.dirty |= changed;
        // 跟伺服器一樣：除了輸入，其他訊息都回一份大廳資訊
        if conn.hello && protocol::wants_room::<R>(&v) && !changed {
            self.outbox.push(json!({"to": id, "msg": protocol::room_message(&self.room, conn)}));
        }
    }

    /// 前進一格；這一格要廣播比賽畫面就回傳它（JSON 文字）
    pub fn tick(&mut self) -> Option<String> {
        let send = self.room.tick();
        self.dirty |= self.room.just_ended();
        if !send {
            return None;
        }
        self.room.frame().map(|f| f.to_string())
    }

    /// 取出要送的訊息：JSON 陣列 [{ to: 連線 id, msg }]
    pub fn drain(&mut self) -> String {
        if std::mem::take(&mut self.dirty) {
            for (id, conn) in &self.conns {
                if conn.hello {
                    self.outbox.push(json!({"to": id, "msg": protocol::room_message(&self.room, conn)}));
                }
            }
        }
        Value::Array(std::mem::take(&mut self.outbox)).to_string()
    }
}
