//+------------------------------------------------------------------+
//| MT5_Bridge.mq5                                                   |
//| TCP bridge EA — connects to a TCP server, executes commands      |
//|                                                                  |
//| Architecture: EA = TCP CLIENT  /  the server = TCP SERVER        |
//|   Start the server first, then attach EA to chart.              |
//|   EA auto-reconnects every few seconds if disconnected.         |
//|                                                                  |
//| Protocol: newline-delimited JSON over TCP                        |
//|                                                                  |
//| Commands (server -> EA):                                         |
//|   {"cmd":"buy",  "symbol":"US500","volume":0.1,"sl":0,"tp":0,"comment":"","id":1}
//|   {"cmd":"sell", "symbol":"US500","volume":0.1,"sl":0,"tp":0,"comment":"","id":2}
//|   {"cmd":"close","ticket":12345,"id":3}                         |
//|   {"cmd":"close_all","symbol":"","id":4}  // symbol optional    |
//|   {"cmd":"ping","id":5}                                          |
//|                                                                  |
//| Events (EA -> server):                                           |
//|   {"type":"ack","id":1,"ok":true,"deal":...,"price":...}        |
//|   {"type":"ack","id":1,"ok":false,"error":"..."}                |
//|   {"type":"position","ticket":...,"symbol":...,"side":...}      |
//|   {"type":"position_closed","ticket":...}                       |
//|   {"type":"order_removed","ticket":...}                         |
//|   {"type":"fill","ticket":...,"entry":"in"|"out",...}           |
//|   {"type":"quote","symbol":...,"bid":...,"ask":...}             |
//|   {"type":"account","balance":...,"equity":...}                 |
//|   {"type":"pong","id":5}                                         |
//+------------------------------------------------------------------+
#property strict
#property description "MT5 Bridge: connects to a TCP server"
#property version     "1.6"
// v1.6: added list_symbols -> streams every broker symbol with its SYMBOL_PATH + description.
//   {"cmd":"list_symbols","id":N}
//     -> N x {"type":"symbol","id":N,"symbol":,"path":<broker tree path>,"description":} then {"type":"symbols_end",...}
// v1.4: added subscribe_depth/unsubscribe_depth -> DOM via MarketBookAdd/OnBookEvent
//   {"cmd":"subscribe_depth","symbol":"US500","id":N} -> {"type":"depth","symbol":,"bids":[{price,qty}],"asks":[...]}
// v1.2: added symbol_info (instrument metadata) and get_bars (CopyRates OHLC) commands
//   {"cmd":"symbol_info","symbol":"US500","id":N}
//     -> {"type":"symbol_info","id":N,"symbol":,"digits":,"point":,"tick_size":,"tick_value":,"contract_size":,...}
//   {"cmd":"get_bars","symbol":"US500","tf":"M5","from":<unix>,"to":<unix|0>,"id":N}
//     -> N x {"type":"bar","symbol":,"tf":,"time":<utc>,"open":,"high":,"low":,"close":,"volume":} then {"type":"bars_end",...}
// v1.2: fixed _ToUTC to use TimeTradeServer() (stable) instead of TimeCurrent() (lags) -> bars align to period.
// v1.3: added subscribe_bars/unsubscribe_bars -> pushes the live forming bar every 500ms ("live":true).
//   {"cmd":"subscribe_bars","symbol":"US500","tf":"M5","id":N} / {"cmd":"unsubscribe_bars",...}
// v1.5: get_bars/get_history now convert the request from/to UTC->server (_FromUTC) before CopyRates/
//   HistorySelect. Was passing UTC ranges raw to server-time APIs, so "to = now" fetched only up to
//   (now - serverOffset) -- the most recent ~offset of bars were missing (a persistent recent-edge hole).

input string InpHost     = "127.0.0.1";  // server host
input int    InpPort     = 7891;          // server port
input int    InpTimerMs  = 100;           // Timer interval (ms)
input bool   InpDebug    = false;         // Print debug messages

//--- socket handle (client)
int _socket = INVALID_HANDLE;

//--- reconnect throttle (real ms clock, NOT TimeCurrent() — must keep retrying
//--- even when the chart symbol is not ticking, e.g. market closed / illiquid)
ulong _last_connect_attempt = 0;
#define RECONNECT_INTERVAL 3   // seconds between connect attempts

//--- receive buffer
string _rbuf = "";

//--- subscribed symbols for quote push
string _symbols[];

//--- live bar subscriptions (parallel arrays: symbol + timeframe code)
string _bar_symbols[];
string _bar_tfs[];

//--- depth-of-market (DOM) subscriptions
string _depth_symbols[];

//--- known position tickets for close detection
ulong _known_tickets[];

//--- known order tickets for removal detection
ulong _known_order_tickets[];

//--- known deal tickets for fill dedup
ulong _known_deals[];

//--- throttle counters
int _tick_counter = 0;

//--- suppress OnTrade duplicate push right after connect
bool _just_connected = false;
// Cadences widened to cut MT5 global-lock contention. Root cause of the terminal freeze (diagnosed 2026-07-20
// from /proc thread wchans: main + symbols + history + net dispatcher + the EA all parked on futexes, 0% CPU =
// a lock-order DEADLOCK): the EA's timer hammered MQL5 data APIs — SymbolInfoTick, CopyRates, and especially
// HistorySelect in _PollFills — every 500ms, each grabbing an internal MT5 lock, and under Wine's spin-then-park
// critical sections that contention deadlocks after a few minutes of a live app connection. Real-time fidelity
// is unaffected: fills/positions/orders/account are ALSO driven by OnTrade (event-accurate); these timer polls
// are only a safety net, so they can run far slower. HistorySelect (the worst offender) drops from 2Hz to 0.2Hz.
#define QUOTE_EVERY 3    // push quotes every 300ms  (3 × 100ms timer)
#define POS_EVERY   10   // push positions every 1s  (10 × 100ms) — OnTrade covers real-time
#define ORD_EVERY   10   // push orders every 1s     (10 × 100ms) — OnTrade covers real-time
#define FILL_EVERY  50   // poll fills every 5s      (50 × 100ms) — OnTrade covers real-time; HistorySelect is the heaviest lock
#define STATUS_EVERY 20  // push broker-connection status every 2s (20 × 100ms)
#define BAR_EVERY   10   // push live forming bars every 1s (10 × 100ms timer)
#define ACCT_EVERY  20   // push account (balance/equity/margin) every 2s (20 × 100ms) -- keeps balance + live equity current


//+------------------------------------------------------------------+
//| Init                                                             |
//+------------------------------------------------------------------+
int OnInit()
{
    _SubscribeSymbol(Symbol());
    EventSetMillisecondTimer(InpTimerMs);
    // Do NOT connect here. SocketConnect (3s timeout) inside OnInit blocks the chart's init on the terminal's
    // main thread; when the app's listener is mid-flux (a reconnect, a rebind) that block is exactly the
    // "initializing … execution canceled" freeze-on-connect seen in the Experts log. Let the first OnTimer
    // tick dial in instead — off the init path, retry-throttled like every other reconnect.
    _last_connect_attempt = 0;   // 0 => first OnTimer connects immediately (GetTickCount64() - 0 >= interval)
    return INIT_SUCCEEDED;
}


//+------------------------------------------------------------------+
//| Deinit                                                           |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
    EventKillTimer();
    for(int i = 0; i < ArraySize(_depth_symbols); i++) MarketBookRelease(_depth_symbols[i]);
    _Disconnect();
}


//+------------------------------------------------------------------+
//| Timer — main loop                                                |
//+------------------------------------------------------------------+
void OnTimer()
{
    //--- reconnect if needed
    if(_socket == INVALID_HANDLE)
    {
        if(GetTickCount64() - _last_connect_attempt >= RECONNECT_INTERVAL * 1000)
            _TryConnect();
        return;
    }

    //--- read & process incoming commands (detects disconnect via read errors)
    _ReadCommands();

    //--- throttled push
    _tick_counter++;

    if(_tick_counter % QUOTE_EVERY == 0)
        _PushQuotes();

    if(_tick_counter % POS_EVERY == 0)
        _PushAllPositions(true);

    if(_tick_counter % ORD_EVERY == 0)
        _PushAllOrders();

    if(_tick_counter % FILL_EVERY == 0)
        _PollFills();

    if(_tick_counter % STATUS_EVERY == 0)
        _PushStatus();

    if(_tick_counter % ACCT_EVERY == 0)
        _PushAccount();   // keep balance/equity/margin current (was only pushed at connect + OnTrade -> stale 0)

    if(_tick_counter % BAR_EVERY == 0)
        _PushLiveBars();
}


//+------------------------------------------------------------------+
//| Broker-connection heartbeat: TERMINAL_CONNECTED is the live link |
//| to the broker/server. The app uses this to show real broker      |
//| connectivity (the EA's own socket can stay up while the broker    |
//| link is down - e.g. running headless).                            |
//+------------------------------------------------------------------+
void _PushStatus()
{
    bool conn = (bool)TerminalInfoInteger(TERMINAL_CONNECTED);
    _Send("{\"type\":\"status\",\"connected\":" + (conn ? "true" : "false") + "}");
}


//+------------------------------------------------------------------+
//| Trade event — positions/orders changed                           |
//+------------------------------------------------------------------+
void OnTrade()
{
    if(_socket == INVALID_HANDLE) return;
    _PollFills();
    if(_just_connected) { _just_connected = false; return; }
    _PushAllPositions(true);
    _PushAllOrders();
    _PushAccount();
}


//+------------------------------------------------------------------+
//| Depth-of-market changed for `symbol` -> push the new book         |
//+------------------------------------------------------------------+
void OnBookEvent(const string &symbol)
{
    if(_socket == INVALID_HANDLE) return;
    for(int i = 0; i < ArraySize(_depth_symbols); i++)
        if(_depth_symbols[i] == symbol) { _PushDepth(symbol); return; }
}




//+------------------------------------------------------------------+
//| Attempt TCP connection to the server                             |
//+------------------------------------------------------------------+
void _TryConnect()
{
    _last_connect_attempt = GetTickCount64();

    int sock = SocketCreate();
    if(sock == INVALID_HANDLE)
    {
        Print("MT5_Bridge: SocketCreate failed err=", GetLastError());
        return;
    }
    if(!SocketConnect(sock, InpHost, InpPort, 3000))
    {
        int err = GetLastError();
        SocketClose(sock);
        if(InpDebug) Print("MT5_Bridge: connect failed err=", err, " (server running?)");
        return;
    }

    _socket = sock;
    _rbuf   = "";
    ArrayResize(_known_tickets, 0);
    ArrayResize(_known_order_tickets, 0);
    ArrayResize(_known_deals, 0);
    _SeedKnownDeals();
    Print("MT5_Bridge: connected to ", InpHost, ":", InpPort);

    // Push initial state on connect
    _just_connected = true;
    _PushAccount();
    _PushAllPositions(true);
    _PushAllOrders();
}


//+------------------------------------------------------------------+
//| Close socket                                                     |
//+------------------------------------------------------------------+
void _Disconnect()
{
    if(_socket != INVALID_HANDLE)
    {
        SocketClose(_socket);
        _socket = INVALID_HANDLE;
        _rbuf   = "";
    }
}


//+------------------------------------------------------------------+
//| Read available bytes, process complete lines                     |
//+------------------------------------------------------------------+
void _ReadCommands()
{
    uchar buf[1];
    int result;
    // Only attempt reads when data is available — SocketRead(timeout=0)
    // returns -1 on some builds when no data, which would false-disconnect.
    while(SocketIsReadable(_socket) > 0)
    {
        result = SocketRead(_socket, buf, 1, 0);
        if(result <= 0)
        {
            Print("MT5_Bridge: read error, disconnecting");
            _Disconnect();
            return;
        }
        if(buf[0] == '\n')
        {
            string line = _rbuf;
            StringTrimLeft(line);
            StringTrimRight(line);
            _rbuf = "";
            if(StringLen(line) > 0)
                _ProcessCommand(line);
        }
        else
        {
            uchar tmp[1];
            tmp[0] = buf[0];
            _rbuf += CharArrayToString(tmp, 0, 1, CP_UTF8);
        }
    }
}


//+------------------------------------------------------------------+
//| Dispatch a received JSON command                                 |
//+------------------------------------------------------------------+
void _ProcessCommand(const string json)
{
    if(InpDebug) Print("MT5_Bridge rx: ", json);

    string cmd = _JStr(json, "cmd");
    long   id  = _JLng(json, "id");

    if(cmd == "buy" || cmd == "sell")
    {
        string sym     = _JStr(json, "symbol");
        double vol     = _JDbl(json, "volume");
        double sl      = _JDbl(json, "sl");
        double tp      = _JDbl(json, "tp");
        string comment = _JStr(json, "comment");
        ENUM_ORDER_TYPE otype = (cmd == "buy") ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
        _ExecMarket(id, sym, otype, vol, sl, tp, comment);
    }
    else if(cmd == "close")
    {
        ulong ticket = (ulong)_JLng(json, "ticket");
        _ClosePosition(id, ticket);
    }
    else if(cmd == "close_all")
    {
        string sym = _JStr(json, "symbol");
        _CloseAll(id, sym);
    }
    else if(cmd == "place_limit" || cmd == "place_stop")
    {
        string sym     = _JStr(json, "symbol");
        string side    = _JStr(json, "side");
        double vol     = _JDbl(json, "volume");
        double price   = _JDbl(json, "price");
        double sl      = _JDbl(json, "sl");
        double tp      = _JDbl(json, "tp");
        string comment = _JStr(json, "comment");
        bool   is_lim  = (cmd == "place_limit");
        ENUM_ORDER_TYPE otype;
        if(side == "buy")
            otype = is_lim ? ORDER_TYPE_BUY_LIMIT  : ORDER_TYPE_BUY_STOP;
        else
            otype = is_lim ? ORDER_TYPE_SELL_LIMIT : ORDER_TYPE_SELL_STOP;
        _ExecPending(id, sym, otype, vol, price, sl, tp, comment);
    }
    else if(cmd == "subscribe")
    {
        string sym = _JStr(json, "symbol");
        if(sym == "") { _Nak(id, "symbol required"); }
        else { _SubscribeSymbol(sym); _Send("{\"type\":\"ack\",\"id\":" + _I(id) + ",\"ok\":true,\"symbol\":\"" + sym + "\"}"); }
    }
    else if(cmd == "partial_close")
    {
        ulong  ticket = (ulong)_JLng(json, "ticket");
        double vol    = _JDbl(json, "volume");
        _PartialClose(id, ticket, vol);
    }
    else if(cmd == "modify_position")
    {
        ulong  ticket = (ulong)_JLng(json, "ticket");
        double sl     = _JDbl(json, "sl");
        double tp     = _JDbl(json, "tp");
        _ModifyPosition(id, ticket, sl, tp);
    }
    else if(cmd == "modify_order")
    {
        ulong  ticket = (ulong)_JLng(json, "ticket");
        double price  = _JDbl(json, "price");
        double sl     = _JDbl(json, "sl");
        double tp     = _JDbl(json, "tp");
        _ModifyOrder(id, ticket, price, sl, tp);
    }
    else if(cmd == "cancel_order")
    {
        ulong ticket = (ulong)_JLng(json, "ticket");
        _CancelOrder(id, ticket);
    }
    else if(cmd == "get_history")
    {
        long from_ts = _FromUTC(_JLng(json, "from"));   // app sends UTC; HistorySelect wants server time
        long to_ts   = _JLng(json, "to");
        to_ts = (to_ts == 0) ? (TimeCurrent() + 86400) : _FromUTC(to_ts);
        _SendHistory(id, (datetime)from_ts, (datetime)to_ts);
    }
    else if(cmd == "symbol_info")
    {
        string sym = _JStr(json, "symbol");
        _SendSymbolInfo(id, sym);
    }
    else if(cmd == "list_symbols")
    {
        _SendSymbolList(id);
    }
    else if(cmd == "get_bars")
    {
        string sym  = _JStr(json, "symbol");
        string tf   = _JStr(json, "tf");
        long   from = _FromUTC(_JLng(json, "from"));   // app sends UTC; CopyRates wants server time
        long   to   = _JLng(json, "to");
        to = (to == 0) ? (TimeCurrent() + 86400) : _FromUTC(to);
        _SendBars(id, sym, tf, (datetime)from, (datetime)to);
    }
    else if(cmd == "subscribe_bars")
    {
        string sym = _JStr(json, "symbol");
        string tf  = _JStr(json, "tf");
        if(sym == "" || tf == "") { _Nak(id, "symbol and tf required"); }
        else { _SubscribeBars(sym, tf); _Send("{\"type\":\"ack\",\"id\":" + _I(id) + ",\"ok\":true,\"symbol\":\"" + sym + "\",\"tf\":\"" + tf + "\"}"); }
    }
    else if(cmd == "unsubscribe_bars")
    {
        string sym = _JStr(json, "symbol");
        string tf  = _JStr(json, "tf");
        _UnsubscribeBars(sym, tf);
        _Send("{\"type\":\"ack\",\"id\":" + _I(id) + ",\"ok\":true,\"symbol\":\"" + sym + "\",\"tf\":\"" + tf + "\"}");
    }
    else if(cmd == "subscribe_depth")
    {
        string sym = _JStr(json, "symbol");
        if(sym == "") { _Nak(id, "symbol required"); }
        else if(_SubscribeDepth(sym)) { _Send("{\"type\":\"ack\",\"id\":" + _I(id) + ",\"ok\":true,\"symbol\":\"" + sym + "\"}"); }
        else { _Nak(id, "MarketBookAdd failed for " + sym + " (no DOM on this symbol?)"); }
    }
    else if(cmd == "unsubscribe_depth")
    {
        string sym = _JStr(json, "symbol");
        _UnsubscribeDepth(sym);
        _Send("{\"type\":\"ack\",\"id\":" + _I(id) + ",\"ok\":true,\"symbol\":\"" + sym + "\"}");
    }
    else if(cmd == "ping")
    {
        _Send("{\"type\":\"pong\",\"id\":" + _I(id) + "}");
    }
    else
    {
        _Send("{\"type\":\"error\",\"id\":" + _I(id) + ",\"error\":\"unknown cmd: " + cmd + "\"}");
    }
}


//+------------------------------------------------------------------+
//| Execute market order                                             |
//+------------------------------------------------------------------+
void _ExecMarket(long id, string sym, ENUM_ORDER_TYPE otype,
                 double vol, double sl, double tp, string comment)
{
    if(sym == "") { _Nak(id, "symbol required"); return; }
    if(vol <= 0)  { _Nak(id, "invalid volume");  return; }

    MqlTick tick;
    if(!SymbolInfoTick(sym, tick)) { _Nak(id, "tick unavailable for " + sym); return; }

    MqlTradeRequest req = {};
    MqlTradeResult  res = {};

    req.action       = TRADE_ACTION_DEAL;
    req.symbol       = sym;
    req.volume       = vol;
    req.type         = otype;
    req.price        = (otype == ORDER_TYPE_BUY) ? tick.ask : tick.bid;
    req.deviation    = 10;
    req.magic        = 888888;
    req.comment      = (comment != "") ? comment : ((otype == ORDER_TYPE_BUY) ? "Bridge_BUY" : "Bridge_SELL");
    req.type_time    = ORDER_TIME_GTC;
    req.type_filling = _FillingMode(sym);

    if(sl > 0) req.sl = sl;
    if(tp > 0) req.tp = tp;

    if(!OrderSend(req, res))
    {
        _Nak(id, "OrderSend error=" + IntegerToString(GetLastError()) + " retcode=" + IntegerToString(res.retcode));
        return;
    }
    if(res.retcode != TRADE_RETCODE_DONE)
    {
        _Nak(id, "Rejected retcode=" + IntegerToString(res.retcode) + " " + res.comment);
        return;
    }

    _Send("{\"type\":\"ack\",\"id\":" + _I(id)
        + ",\"ok\":true"
        + ",\"deal\":"   + _I((long)res.deal)
        + ",\"price\":"  + _D(res.price, 5)
        + ",\"volume\":" + _D(res.volume, 2) + "}");

    _SubscribeSymbol(sym);

    string side_s = (otype == ORDER_TYPE_BUY) ? "buy" : "sell";
    _EmitFill(res.deal, sym, res.volume, res.price, side_s, "in", (long)res.deal);
}


//+------------------------------------------------------------------+
//| Place pending (limit or stop) order                              |
//+------------------------------------------------------------------+
void _ExecPending(long id, string sym, ENUM_ORDER_TYPE otype,
                  double vol, double price, double sl, double tp, string comment)
{
    if(sym == "")  { _Nak(id, "symbol required"); return; }
    if(vol <= 0)   { _Nak(id, "invalid volume");  return; }
    if(price <= 0) { _Nak(id, "price required");  return; }

    MqlTradeRequest req = {};
    MqlTradeResult  res = {};

    req.action       = TRADE_ACTION_PENDING;
    req.symbol       = sym;
    req.volume       = vol;
    req.type         = otype;
    req.price        = price;
    req.deviation    = 10;
    req.magic        = 888888;
    req.comment      = (comment != "") ? comment : "Bridge_PENDING";
    req.type_time    = ORDER_TIME_GTC;
    req.type_filling = _FillingMode(sym);
    if(sl > 0) req.sl = sl;
    if(tp > 0) req.tp = tp;

    if(!OrderSend(req, res))
    {
        _Nak(id, "OrderSend error=" + IntegerToString(GetLastError()) + " retcode=" + IntegerToString(res.retcode));
        return;
    }
    if(res.retcode != TRADE_RETCODE_DONE && res.retcode != TRADE_RETCODE_PLACED)
    {
        _Nak(id, "Rejected retcode=" + IntegerToString(res.retcode) + " " + res.comment);
        return;
    }

    _Send("{\"type\":\"ack\",\"id\":" + _I(id)
        + ",\"ok\":true"
        + ",\"order\":"  + _I((long)res.order)
        + ",\"price\":"  + _D(price, 5) + "}");

    _SubscribeSymbol(sym);
}


//+------------------------------------------------------------------+
//| Close position by ticket                                         |
//+------------------------------------------------------------------+
void _ClosePosition(long id, ulong ticket)
{
    bool found = false;
    int total = PositionsTotal();
    for(int i = 0; i < total; i++)
        if(PositionGetTicket(i) == ticket) { found = true; break; }
    if(!found)
    {
        _Nak(id, "position " + IntegerToString((long)ticket) + " not found");
        return;
    }

    string sym  = PositionGetString(POSITION_SYMBOL);
    double vol  = PositionGetDouble(POSITION_VOLUME);
    ENUM_POSITION_TYPE ptype = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);

    MqlTick tick;
    if(!SymbolInfoTick(sym, tick)) { _Nak(id, "tick unavailable for " + sym); return; }

    MqlTradeRequest req = {};
    MqlTradeResult  res = {};

    req.action       = TRADE_ACTION_DEAL;
    req.symbol       = sym;
    req.volume       = vol;
    req.position     = ticket;
    req.type         = (ptype == POSITION_TYPE_BUY) ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
    req.price        = (ptype == POSITION_TYPE_BUY) ? tick.bid : tick.ask;
    req.deviation    = 10;
    req.magic        = 888888;
    req.comment      = "Bridge_CLOSE";
    req.type_time    = ORDER_TIME_GTC;
    req.type_filling = _FillingMode(sym);

    if(!OrderSend(req, res))
    {
        _Nak(id, "OrderSend error=" + IntegerToString(GetLastError()));
        return;
    }
    if(res.retcode != TRADE_RETCODE_DONE)
    {
        _Nak(id, "Rejected retcode=" + IntegerToString(res.retcode) + " " + res.comment);
        return;
    }

    _Send("{\"type\":\"ack\",\"id\":" + _I(id)
        + ",\"ok\":true"
        + ",\"ticket\":"  + _I((long)ticket)
        + ",\"price\":"   + _D(res.price, 5)
        + ",\"volume\":"  + _D(vol, 2) + "}");

    string close_side = (ptype == POSITION_TYPE_BUY) ? "sell" : "buy";
    _EmitFill(res.deal, sym, vol, res.price, close_side, "out", (long)ticket);
}


//+------------------------------------------------------------------+
//| Stream historical deals between two unix timestamps             |
//+------------------------------------------------------------------+
void _SendHistory(long id, datetime from_dt, datetime to_dt)
{
    if(!HistorySelect(from_dt, to_dt))
    {
        _Nak(id, "HistorySelect failed");
        return;
    }

    int total = HistoryDealsTotal();
    int sent  = 0;

    for(int i = 0; i < total; i++)
    {
        ulong deal = HistoryDealGetTicket(i);
        if(deal == 0) continue;

        ENUM_DEAL_TYPE  dtype = (ENUM_DEAL_TYPE) HistoryDealGetInteger(deal, DEAL_TYPE);
        ENUM_DEAL_ENTRY entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(deal, DEAL_ENTRY);

        // Skip balance/credit/commission-only entries
        if(dtype != DEAL_TYPE_BUY && dtype != DEAL_TYPE_SELL) continue;

        string  sym    = HistoryDealGetString(deal,  DEAL_SYMBOL);
        double  vol    = HistoryDealGetDouble(deal,  DEAL_VOLUME);
        double  price  = HistoryDealGetDouble(deal,  DEAL_PRICE);
        double  profit = HistoryDealGetDouble(deal,  DEAL_PROFIT);
        double  comm   = HistoryDealGetDouble(deal,  DEAL_COMMISSION);
        double  swap   = HistoryDealGetDouble(deal,  DEAL_SWAP);
        long    ts     = HistoryDealGetInteger(deal, DEAL_TIME);
        long    pos_id = HistoryDealGetInteger(deal, DEAL_POSITION_ID);

        string side_s  = (dtype == DEAL_TYPE_BUY) ? "buy" : "sell";
        string entry_s = "in";
        if(entry == DEAL_ENTRY_OUT)   entry_s = "out";
        if(entry == DEAL_ENTRY_INOUT) entry_s = "inout";

        _Send("{\"type\":\"fill\""
            + ",\"ticket\":"      + _I((long)deal)
            + ",\"position_id\":" + _I(pos_id)
            + ",\"symbol\":\""    + sym + "\""
            + ",\"side\":\""      + side_s + "\""
            + ",\"entry\":\""     + entry_s + "\""
            + ",\"volume\":"      + _D(vol, 2)
            + ",\"price\":"       + _D(price, 5)
            + ",\"profit\":"      + _D(profit, 2)
            + ",\"commission\":"  + _D(comm, 2)
            + ",\"swap\":"        + _D(swap, 2)
            + ",\"time\":"        + _I(_ToUTC(ts))
            + ",\"historical\":true}");
        sent++;
    }

    _Send("{\"type\":\"history_end\",\"id\":" + _I(id)
        + ",\"count\":" + _I((long)sent) + "}");
}


//+------------------------------------------------------------------+
//| Send instrument metadata (digits, tick size/value, contract...)  |
//| Feeds the app's resolveSymbol so prices format correctly and     |
//| P&L math has the real tick value (no more hardcoded 5 decimals). |
//+------------------------------------------------------------------+
void _SendSymbolInfo(long id, string sym)
{
    if(sym == "") { _Nak(id, "symbol required"); return; }
    if(!SymbolSelect(sym, true)) { _Nak(id, "symbol not found: " + sym); return; }

    int    digits    = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
    double point     = SymbolInfoDouble(sym,  SYMBOL_POINT);
    double tick_size = SymbolInfoDouble(sym,  SYMBOL_TRADE_TICK_SIZE);
    double tick_val  = SymbolInfoDouble(sym,  SYMBOL_TRADE_TICK_VALUE);
    double contract  = SymbolInfoDouble(sym,  SYMBOL_TRADE_CONTRACT_SIZE);
    double vol_min   = SymbolInfoDouble(sym,  SYMBOL_VOLUME_MIN);
    double vol_step  = SymbolInfoDouble(sym,  SYMBOL_VOLUME_STEP);
    int    book_dep  = (int)SymbolInfoInteger(sym, SYMBOL_TICKS_BOOKDEPTH);   // 0 = no real DOM (synthetic ladder only)
    string desc      = SymbolInfoString(sym,  SYMBOL_DESCRIPTION);

    _Send("{\"type\":\"symbol_info\""
        + ",\"id\":"            + _I(id)
        + ",\"symbol\":\""      + sym + "\""
        + ",\"digits\":"        + _I(digits)
        + ",\"point\":"         + _D(point, digits)
        + ",\"tick_size\":"     + _D(tick_size, digits)
        + ",\"tick_value\":"    + _D(tick_val, 5)
        + ",\"contract_size\":" + _D(contract, 2)
        + ",\"volume_min\":"    + _D(vol_min, 2)
        + ",\"volume_step\":"   + _D(vol_step, 2)
        + ",\"book_depth\":"    + _I(book_dep)
        + ",\"description\":\"" + desc + "\"}");
}


//+------------------------------------------------------------------+
//| Enumerate every symbol in the broker's symbol tree. Streams one   |
//| 'symbol' line each (code + SYMBOL_PATH grouping + description),    |
//| then a 'symbols_end'. Feeds the app's symbol browser, which       |
//| splits the path on '\' to build group -> subgroup -> instrument.  |
//| SymbolsTotal(false) = ALL broker symbols, not just Market Watch.  |
//| One-shot on demand (the dialog opening), NOT a timer poll, so the |
//| burst of SymbolInfoString reads is a single pass, not sustained   |
//| lock contention. path/desc are escaped: SYMBOL_PATH is literally  |
//| backslash-delimited and would otherwise break the JSON.           |
//+------------------------------------------------------------------+
void _SendSymbolList(long id)
{
    int total = SymbolsTotal(false);
    int sent  = 0;
    for(int i = 0; i < total; i++)
    {
        string sym = SymbolName(i, false);
        if(sym == "") continue;
        string path = SymbolInfoString(sym, SYMBOL_PATH);
        string desc = SymbolInfoString(sym, SYMBOL_DESCRIPTION);
        _Send("{\"type\":\"symbol\""
            + ",\"id\":"            + _I(id)
            + ",\"symbol\":\""      + _JsonEsc(sym)  + "\""
            + ",\"path\":\""        + _JsonEsc(path) + "\""
            + ",\"description\":\"" + _JsonEsc(desc) + "\"}");
        sent++;
    }
    _Send("{\"type\":\"symbols_end\",\"id\":" + _I(id)
        + ",\"count\":" + _I((long)sent) + "}");
}


//+------------------------------------------------------------------+
//| Map a wire timeframe code (MT5-native: M1,M5,H1,D1...) to enum    |
//+------------------------------------------------------------------+
ENUM_TIMEFRAMES _PeriodFromStr(string s)
{
    if(s == "M1")  return PERIOD_M1;
    if(s == "M2")  return PERIOD_M2;
    if(s == "M3")  return PERIOD_M3;
    if(s == "M4")  return PERIOD_M4;
    if(s == "M5")  return PERIOD_M5;
    if(s == "M6")  return PERIOD_M6;
    if(s == "M10") return PERIOD_M10;
    if(s == "M12") return PERIOD_M12;
    if(s == "M15") return PERIOD_M15;
    if(s == "M20") return PERIOD_M20;
    if(s == "M30") return PERIOD_M30;
    if(s == "H1")  return PERIOD_H1;
    if(s == "H2")  return PERIOD_H2;
    if(s == "H3")  return PERIOD_H3;
    if(s == "H4")  return PERIOD_H4;
    if(s == "H6")  return PERIOD_H6;
    if(s == "H8")  return PERIOD_H8;
    if(s == "H12") return PERIOD_H12;
    if(s == "D1")  return PERIOD_D1;
    if(s == "W1")  return PERIOD_W1;
    if(s == "MN1") return PERIOD_MN1;
    return PERIOD_M1;
}


//+------------------------------------------------------------------+
//| Stream historical OHLC bars for [from,to] via CopyRates. Emits    |
//| N 'bar' lines (chronological, UTC times) then a 'bars_end'.       |
//+------------------------------------------------------------------+
void _SendBars(long id, string sym, string tf, datetime from_dt, datetime to_dt)
{
    if(sym == "") { _Nak(id, "symbol required"); return; }
    if(!SymbolSelect(sym, true)) { _Nak(id, "symbol not found: " + sym); return; }

    ENUM_TIMEFRAMES period = _PeriodFromStr(tf);
    MqlRates rates[];
    ArraySetAsSeries(rates, false);   // index 0 = oldest -> stream in chronological order
    int n = CopyRates(sym, period, from_dt, to_dt, rates);
    if(n < 0)
    {
        _Nak(id, "CopyRates failed err=" + IntegerToString(GetLastError()));
        return;
    }

    int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
    for(int i = 0; i < n; i++)
    {
        _Send("{\"type\":\"bar\""
            + ",\"symbol\":\"" + sym + "\""
            + ",\"tf\":\""     + tf + "\""
            + ",\"time\":"     + _I(_ToUTC((long)rates[i].time))
            + ",\"open\":"     + _D(rates[i].open,  digits)
            + ",\"high\":"     + _D(rates[i].high,  digits)
            + ",\"low\":"      + _D(rates[i].low,   digits)
            + ",\"close\":"    + _D(rates[i].close, digits)
            + ",\"volume\":"   + _I((long)rates[i].tick_volume) + "}");
    }

    _Send("{\"type\":\"bars_end\",\"id\":" + _I(id)
        + ",\"symbol\":\"" + sym + "\""
        + ",\"tf\":\""     + tf + "\""
        + ",\"count\":"    + _I((long)n) + "}");
}


//+------------------------------------------------------------------+
//| Partially close a position (specified volume)                   |
//+------------------------------------------------------------------+
void _PartialClose(long id, ulong ticket, double vol)
{
    bool found = false;
    int total = PositionsTotal();
    for(int i = 0; i < total; i++)
        if(PositionGetTicket(i) == ticket) { found = true; break; }
    if(!found)
    {
        _Nak(id, "position " + IntegerToString((long)ticket) + " not found");
        return;
    }

    double pos_vol = PositionGetDouble(POSITION_VOLUME);
    if(vol <= 0)
    {
        _Nak(id, "volume must be > 0");
        return;
    }

    // If vol >= full position, treat as full close
    if(vol >= pos_vol)
    {
        _ClosePosition(id, ticket);
        return;
    }

    string sym   = PositionGetString(POSITION_SYMBOL);
    ENUM_POSITION_TYPE ptype = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);

    MqlTick tick;
    if(!SymbolInfoTick(sym, tick)) { _Nak(id, "tick unavailable for " + sym); return; }

    MqlTradeRequest req = {};
    MqlTradeResult  res = {};
    req.action       = TRADE_ACTION_DEAL;
    req.symbol       = sym;
    req.volume       = vol;
    req.position     = ticket;
    req.type         = (ptype == POSITION_TYPE_BUY) ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
    req.price        = (ptype == POSITION_TYPE_BUY) ? tick.bid : tick.ask;
    req.deviation    = 10;
    req.magic        = 888888;
    req.comment      = "Bridge_PARTIAL";
    req.type_time    = ORDER_TIME_GTC;
    req.type_filling = _FillingMode(sym);

    if(!OrderSend(req, res))
    {
        _Nak(id, "OrderSend error=" + IntegerToString(GetLastError()));
        return;
    }
    if(res.retcode != TRADE_RETCODE_DONE)
    {
        _Nak(id, "Rejected retcode=" + IntegerToString(res.retcode) + " " + res.comment);
        return;
    }

    _Send("{\"type\":\"ack\",\"id\":" + _I(id)
        + ",\"ok\":true"
        + ",\"ticket\":"  + _I((long)ticket)
        + ",\"closed\":"  + _D(vol, 2)
        + ",\"price\":"   + _D(res.price, 5) + "}");

    string partial_side = (ptype == POSITION_TYPE_BUY) ? "sell" : "buy";
    _EmitFill(res.deal, sym, vol, res.price, partial_side, "out", (long)ticket);
}


//+------------------------------------------------------------------+
//| Modify sl/tp of an open position                                |
//+------------------------------------------------------------------+
void _ModifyPosition(long id, ulong ticket, double sl, double tp)
{
    bool found = false;
    int total = PositionsTotal();
    for(int i = 0; i < total; i++)
        if(PositionGetTicket(i) == ticket) { found = true; break; }
    if(!found)
    {
        _Nak(id, "position " + IntegerToString((long)ticket) + " not found");
        return;
    }

    string sym = PositionGetString(POSITION_SYMBOL);

    // sl/tp are ABSOLUTE (MT5-native): 0 = REMOVE that level. Every caller sends the full intended state of
    // both legs (the app supplies the other leg's current value when editing one), so no keep-current fallback
    // -- the old 0=keep re-sent identical values on a removal and OrderSend rejected the no-change modify.

    MqlTradeRequest req = {};
    MqlTradeResult  res = {};
    req.action   = TRADE_ACTION_SLTP;
    req.symbol   = sym;
    req.position = ticket;
    req.sl       = sl;
    req.tp       = tp;

    if(!OrderSend(req, res))
    {
        _Nak(id, "OrderSend error=" + IntegerToString(GetLastError()));
        return;
    }
    if(res.retcode != TRADE_RETCODE_DONE)
    {
        _Nak(id, "Rejected retcode=" + IntegerToString(res.retcode) + " " + res.comment);
        return;
    }

    _Send("{\"type\":\"ack\",\"id\":" + _I(id)
        + ",\"ok\":true"
        + ",\"ticket\":" + _I((long)ticket)
        + ",\"sl\":"     + _D(sl, 5)
        + ",\"tp\":"     + _D(tp, 5) + "}");
}


//+------------------------------------------------------------------+
//| Modify price/sl/tp of a pending order                           |
//+------------------------------------------------------------------+
void _ModifyOrder(long id, ulong ticket, double price, double sl, double tp)
{
    if(!OrderSelect(ticket))
    {
        _Nak(id, "order " + IntegerToString((long)ticket) + " not found");
        return;
    }

    string sym   = OrderGetString(ORDER_SYMBOL);
    ENUM_ORDER_TYPE otype = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);

    // price: 0 = not supplied -> keep the order's open price. sl/tp are ABSOLUTE (MT5-native), 0 = REMOVE that leg --
    // the SAME convention as _ModifyPosition: every caller sends the full intended state of BOTH legs (the app supplies
    // the other leg's current value when editing one), so there is no 0=keep guess and the pill's X can clear a leg.
    if(price == 0) price = OrderGetDouble(ORDER_PRICE_OPEN);

    MqlTradeRequest req = {};
    MqlTradeResult  res = {};
    req.action     = TRADE_ACTION_MODIFY;
    req.order      = ticket;
    req.symbol     = sym;
    req.type       = otype;
    req.price      = price;
    req.sl         = sl;
    req.tp         = tp;
    req.type_time  = (ENUM_ORDER_TYPE_TIME)OrderGetInteger(ORDER_TYPE_TIME);
    req.expiration = (datetime)OrderGetInteger(ORDER_TIME_EXPIRATION);

    if(!OrderSend(req, res))
    {
        _Nak(id, "OrderSend error=" + IntegerToString(GetLastError()));
        return;
    }
    if(res.retcode != TRADE_RETCODE_DONE)
    {
        _Nak(id, "Rejected retcode=" + IntegerToString(res.retcode) + " " + res.comment);
        return;
    }

    _Send("{\"type\":\"ack\",\"id\":" + _I(id)
        + ",\"ok\":true"
        + ",\"ticket\":" + _I((long)ticket)
        + ",\"price\":"  + _D(price, 5)
        + ",\"sl\":"     + _D(sl, 5)
        + ",\"tp\":"     + _D(tp, 5) + "}");
}


//+------------------------------------------------------------------+
//| Cancel a single pending order by ticket                          |
//+------------------------------------------------------------------+
void _CancelOrder(long id, ulong ticket)
{
    if(!OrderSelect(ticket))
    {
        _Nak(id, "order " + IntegerToString((long)ticket) + " not found");
        return;
    }

    MqlTradeRequest req = {};
    MqlTradeResult  res = {};
    req.action = TRADE_ACTION_REMOVE;
    req.order  = ticket;

    if(!OrderSend(req, res))
    {
        _Nak(id, "OrderSend error=" + IntegerToString(GetLastError()));
        return;
    }
    if(res.retcode != TRADE_RETCODE_DONE)
    {
        _Nak(id, "Rejected retcode=" + IntegerToString(res.retcode) + " " + res.comment);
        return;
    }

    _Send("{\"type\":\"ack\",\"id\":" + _I(id)
        + ",\"ok\":true"
        + ",\"ticket\":" + _I((long)ticket) + "}");
}


//+------------------------------------------------------------------+
//| Close all positions (optional symbol filter)                     |
//+------------------------------------------------------------------+
void _CloseAll(long id, string sym_filter)
{
    int closed = 0, failed = 0;

    // ── Cancel pending orders ─────────────────────────────────────────────
    int ord_total = OrdersTotal();
    for(int i = ord_total - 1; i >= 0; i--)
    {
        ulong ticket = OrderGetTicket(i);
        if(ticket == 0) continue;
        if(sym_filter != "" && OrderGetString(ORDER_SYMBOL) != sym_filter) continue;

        MqlTradeRequest req = {};
        MqlTradeResult  res = {};
        req.action = TRADE_ACTION_REMOVE;
        req.order  = ticket;

        if(OrderSend(req, res) && res.retcode == TRADE_RETCODE_DONE) closed++;
        else failed++;
    }

    // ── Close open positions ──────────────────────────────────────────────
    int pos_total = PositionsTotal();
    for(int i = pos_total - 1; i >= 0; i--)
    {
        ulong ticket = PositionGetTicket(i);
        if(ticket == 0) continue;
        if(sym_filter != "" && PositionGetString(POSITION_SYMBOL) != sym_filter) continue;

        string sym  = PositionGetString(POSITION_SYMBOL);
        double vol  = PositionGetDouble(POSITION_VOLUME);
        ENUM_POSITION_TYPE ptype = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);

        MqlTick tick;
        if(!SymbolInfoTick(sym, tick)) { failed++; continue; }

        MqlTradeRequest req = {};
        MqlTradeResult  res = {};
        req.action       = TRADE_ACTION_DEAL;
        req.symbol       = sym;
        req.volume       = vol;
        req.position     = ticket;
        req.type         = (ptype == POSITION_TYPE_BUY) ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
        req.price        = (ptype == POSITION_TYPE_BUY) ? tick.bid : tick.ask;
        req.deviation    = 10;
        req.magic        = 888888;
        req.comment      = "Bridge_CLOSE_ALL";
        req.type_time    = ORDER_TIME_GTC;
        req.type_filling = _FillingMode(sym);

        if(OrderSend(req, res) && res.retcode == TRADE_RETCODE_DONE) closed++;
        else failed++;
    }

    _Send("{\"type\":\"ack\",\"id\":" + _I(id)
        + ",\"ok\":"     + (failed == 0 ? "true" : "false")
        + ",\"closed\":" + _I((long)closed)
        + ",\"failed\":" + _I((long)failed) + "}");
}


//+------------------------------------------------------------------+
//| Emit a fill event and mark deal as known                        |
//+------------------------------------------------------------------+
void _EmitFill(ulong deal_ticket, string sym, double vol, double price,
               string side_s, string entry_s, long pos_id)
{
    // Mark as known so _PollFills won't re-emit it
    int sz = ArraySize(_known_deals);
    ArrayResize(_known_deals, sz + 1);
    _known_deals[sz] = deal_ticket;

    double comm   = 0.0;
    double profit = 0.0;
    double swap   = 0.0;
    long   ts     = TimeCurrent();
    if(HistoryDealSelect(deal_ticket))
    {
        comm   = HistoryDealGetDouble(deal_ticket,  DEAL_COMMISSION);
        profit = HistoryDealGetDouble(deal_ticket,  DEAL_PROFIT);
        swap   = HistoryDealGetDouble(deal_ticket,  DEAL_SWAP);
        ts     = HistoryDealGetInteger(deal_ticket, DEAL_TIME);
        pos_id = HistoryDealGetInteger(deal_ticket, DEAL_POSITION_ID);
    }

    _Send("{\"type\":\"fill\""
        + ",\"ticket\":"      + _I((long)deal_ticket)
        + ",\"position_id\":" + _I(pos_id)
        + ",\"symbol\":\""    + sym + "\""
        + ",\"side\":\""      + side_s + "\""
        + ",\"entry\":\""     + entry_s + "\""
        + ",\"volume\":"      + _D(vol, 2)
        + ",\"price\":"       + _D(price, 5)
        + ",\"profit\":"      + _D(profit, 2)
        + ",\"commission\":"  + _D(comm, 2)
        + ",\"swap\":"        + _D(swap, 2)
        + ",\"time\":"        + _I(_ToUTC(ts)) + "}");
}


//+------------------------------------------------------------------+
//| Seed _known_deals with existing deals so we don't replay them   |
//+------------------------------------------------------------------+
void _SeedKnownDeals()
{
    datetime from_dt = (datetime)(TimeCurrent() - 600);
    if(!HistorySelect(from_dt, (datetime)(TimeCurrent() + 3600))) return;
    int total = HistoryDealsTotal();
    for(int i = 0; i < total; i++)
    {
        ulong deal = HistoryDealGetTicket(i);
        if(deal == 0) continue;
        int sz = ArraySize(_known_deals);
        ArrayResize(_known_deals, sz + 1);
        _known_deals[sz] = deal;
    }
}


//+------------------------------------------------------------------+
//| Poll deal history and emit new fills (mirrors _poll_fills)       |
//+------------------------------------------------------------------+
void _PollFills()
{
    datetime from_dt = (datetime)(TimeCurrent() - 600);
    HistorySelect(from_dt, (datetime)(TimeCurrent() + 3600));

    int total = HistoryDealsTotal();
    for(int i = 0; i < total; i++)
    {
        ulong deal = HistoryDealGetTicket(i);
        if(deal == 0) continue;

        bool known = false;
        for(int j = 0; j < ArraySize(_known_deals); j++)
            if(_known_deals[j] == deal) { known = true; break; }
        if(known) continue;

        int sz = ArraySize(_known_deals);
        ArrayResize(_known_deals, sz + 1);
        _known_deals[sz] = deal;

        ENUM_DEAL_TYPE  dtype = (ENUM_DEAL_TYPE) HistoryDealGetInteger(deal, DEAL_TYPE);
        ENUM_DEAL_ENTRY entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(deal, DEAL_ENTRY);

        if(dtype != DEAL_TYPE_BUY && dtype != DEAL_TYPE_SELL) continue;

        string  sym    = HistoryDealGetString(deal,  DEAL_SYMBOL);
        double  vol    = HistoryDealGetDouble(deal,  DEAL_VOLUME);
        double  price  = HistoryDealGetDouble(deal,  DEAL_PRICE);
        double  profit = HistoryDealGetDouble(deal,  DEAL_PROFIT);
        double  comm   = HistoryDealGetDouble(deal,  DEAL_COMMISSION);
        double  swap   = HistoryDealGetDouble(deal,  DEAL_SWAP);
        long    ts     = HistoryDealGetInteger(deal, DEAL_TIME);
        long    pos_id = HistoryDealGetInteger(deal, DEAL_POSITION_ID);

        string side_s  = (dtype == DEAL_TYPE_BUY) ? "buy" : "sell";
        string entry_s = "in";
        if(entry == DEAL_ENTRY_OUT)   entry_s = "out";
        if(entry == DEAL_ENTRY_INOUT) entry_s = "inout";

        _Send("{\"type\":\"fill\""
            + ",\"ticket\":"      + _I((long)deal)
            + ",\"position_id\":" + _I(pos_id)
            + ",\"symbol\":\""    + sym + "\""
            + ",\"side\":\""      + side_s + "\""
            + ",\"entry\":\""     + entry_s + "\""
            + ",\"volume\":"      + _D(vol, 2)
            + ",\"price\":"       + _D(price, 5)
            + ",\"profit\":"      + _D(profit, 2)
            + ",\"commission\":"  + _D(comm, 2)
            + ",\"swap\":"        + _D(swap, 2)
            + ",\"time\":"        + _I(_ToUTC(ts)) + "}");
    }
}


//+------------------------------------------------------------------+
//| Push all positions; detect and notify closed ones                |
//+------------------------------------------------------------------+
void _PushAllPositions(bool detect_closed)
{
    int   total = PositionsTotal();
    ulong current[];

    for(int i = 0; i < total; i++)
    {
        ulong ticket = PositionGetTicket(i);   // also selects position for reading
        if(ticket == 0) continue;
        int sz = ArraySize(current);
        ArrayResize(current, sz + 1);
        current[sz] = ticket;

        // Read position data directly (PositionGetTicket already selected it)
        string sym    = PositionGetString(POSITION_SYMBOL);
        double vol    = PositionGetDouble(POSITION_VOLUME);
        double open_p = PositionGetDouble(POSITION_PRICE_OPEN);
        double cur_p  = PositionGetDouble(POSITION_PRICE_CURRENT);
        double sl     = PositionGetDouble(POSITION_SL);
        double tp     = PositionGetDouble(POSITION_TP);
        double profit = PositionGetDouble(POSITION_PROFIT);
        ENUM_POSITION_TYPE ptype = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
        string side = (ptype == POSITION_TYPE_BUY) ? "buy" : "sell";

        _Send("{\"type\":\"position\""
            + ",\"ticket\":"     + _I((long)ticket)
            + ",\"symbol\":\""   + sym + "\""
            + ",\"side\":\""     + side + "\""
            + ",\"volume\":"     + _D(vol, 2)
            + ",\"open_price\":" + _D(open_p, 5)
            + ",\"cur_price\":"  + _D(cur_p, 5)
            + ",\"sl\":"         + _D(sl, 5)
            + ",\"tp\":"         + _D(tp, 5)
            + ",\"profit\":"     + _D(profit, 2) + "}");
    }

    if(detect_closed)
    {
        for(int i = 0; i < ArraySize(_known_tickets); i++)
        {
            bool found = false;
            for(int j = 0; j < ArraySize(current); j++)
                if(current[j] == _known_tickets[i]) { found = true; break; }
            if(!found)
                _Send("{\"type\":\"position_closed\",\"ticket\":" + _I((long)_known_tickets[i]) + "}");
        }
        ArrayResize(_known_tickets, ArraySize(current));
        if(ArraySize(current) > 0)
            ArrayCopy(_known_tickets, current);
    }
}


//+------------------------------------------------------------------+
//| Push single position snapshot                                    |
//+------------------------------------------------------------------+
void _PushPosition(ulong ticket)
{
    if(!PositionSelectByTicket(ticket)) return;

    string sym    = PositionGetString(POSITION_SYMBOL);
    double vol    = PositionGetDouble(POSITION_VOLUME);
    double open_p = PositionGetDouble(POSITION_PRICE_OPEN);
    double cur_p  = PositionGetDouble(POSITION_PRICE_CURRENT);
    double sl     = PositionGetDouble(POSITION_SL);
    double tp     = PositionGetDouble(POSITION_TP);
    double profit = PositionGetDouble(POSITION_PROFIT);
    ENUM_POSITION_TYPE ptype = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
    string side = (ptype == POSITION_TYPE_BUY) ? "buy" : "sell";

    _Send("{\"type\":\"position\""
        + ",\"ticket\":"     + _I((long)ticket)
        + ",\"symbol\":\""   + sym + "\""
        + ",\"side\":\""     + side + "\""
        + ",\"volume\":"     + _D(vol, 2)
        + ",\"open_price\":" + _D(open_p, 5)
        + ",\"cur_price\":"  + _D(cur_p, 5)
        + ",\"sl\":"         + _D(sl, 5)
        + ",\"tp\":"         + _D(tp, 5)
        + ",\"profit\":"     + _D(profit, 2) + "}");
}


//+------------------------------------------------------------------+
//| Push all pending/working orders; detect and notify removed ones  |
//+------------------------------------------------------------------+
void _PushAllOrders()
{
    int   total = OrdersTotal();
    ulong current[];

    for(int i = 0; i < total; i++)
    {
        ulong ticket = OrderGetTicket(i);
        if(ticket == 0) continue;
        int sz = ArraySize(current);
        ArrayResize(current, sz + 1);
        current[sz] = ticket;
        _PushOrder(ticket);
    }

    // Detect removed orders (filled, cancelled, or expired)
    for(int i = 0; i < ArraySize(_known_order_tickets); i++)
    {
        bool found = false;
        for(int j = 0; j < ArraySize(current); j++)
            if(current[j] == _known_order_tickets[i]) { found = true; break; }
        if(!found)
            _Send("{\"type\":\"order_removed\",\"ticket\":" + _I((long)_known_order_tickets[i]) + "}");
    }
    ArrayResize(_known_order_tickets, ArraySize(current));
    if(ArraySize(current) > 0)
        ArrayCopy(_known_order_tickets, current);
}


//+------------------------------------------------------------------+
//| Push single working order                                        |
//+------------------------------------------------------------------+
void _PushOrder(ulong ticket)
{
    if(!OrderSelect(ticket)) return;

    ENUM_ORDER_TYPE otype = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
    string type_s = "", side_s = "";
    if     (otype == ORDER_TYPE_BUY_LIMIT)  { type_s = "limit"; side_s = "buy"; }
    else if(otype == ORDER_TYPE_SELL_LIMIT) { type_s = "limit"; side_s = "sell"; }
    else if(otype == ORDER_TYPE_BUY_STOP)   { type_s = "stop";  side_s = "buy"; }
    else if(otype == ORDER_TYPE_SELL_STOP)  { type_s = "stop";  side_s = "sell"; }
    else return;

    string sym   = OrderGetString(ORDER_SYMBOL);
    double vol   = OrderGetDouble(ORDER_VOLUME_CURRENT);
    double price = OrderGetDouble(ORDER_PRICE_OPEN);
    double sl    = OrderGetDouble(ORDER_SL);
    double tp    = OrderGetDouble(ORDER_TP);
    long   tsu   = OrderGetInteger(ORDER_TIME_SETUP);

    _Send("{\"type\":\"order\""
        + ",\"ticket\":"       + _I((long)ticket)
        + ",\"symbol\":\""     + sym + "\""
        + ",\"order_type\":\"" + type_s + "\""
        + ",\"side\":\""       + side_s + "\""
        + ",\"volume\":"       + _D(vol, 2)
        + ",\"price\":"        + _D(price, 5)
        + ",\"sl\":"           + _D(sl, 5)
        + ",\"tp\":"           + _D(tp, 5)
        + ",\"time\":"         + _I(tsu) + "}");
}


//+------------------------------------------------------------------+
//| Push quotes for subscribed symbols                               |
//+------------------------------------------------------------------+
void _PushQuotes()
{
    for(int i = 0; i < ArraySize(_symbols); i++)
    {
        MqlTick tick;
        if(!SymbolInfoTick(_symbols[i], tick)) continue;
        _Send("{\"type\":\"quote\""
            + ",\"symbol\":\""  + _symbols[i] + "\""
            + ",\"bid\":"       + _D(tick.bid, 5)
            + ",\"ask\":"       + _D(tick.ask, 5)
            + ",\"time\":"      + _I(_ToUTC((long)tick.time)) + "}");
    }
}


//+------------------------------------------------------------------+
//| Push account snapshot                                            |
//+------------------------------------------------------------------+
void _PushAccount()
{
    double balance  = AccountInfoDouble(ACCOUNT_BALANCE);
    double equity   = AccountInfoDouble(ACCOUNT_EQUITY);
    double margin   = AccountInfoDouble(ACCOUNT_MARGIN);
    double free_mrg = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
    bool   hedging  = (AccountInfoInteger(ACCOUNT_MARGIN_MODE) == ACCOUNT_MARGIN_MODE_RETAIL_HEDGING);
    long   login    = AccountInfoInteger(ACCOUNT_LOGIN);
    string currency = AccountInfoString(ACCOUNT_CURRENCY);

    _Send("{\"type\":\"account\""
        + ",\"login\":"      + _I(login)
        + ",\"currency\":\"" + currency + "\""
        + ",\"balance\":"    + _D(balance, 2)
        + ",\"equity\":"     + _D(equity, 2)
        + ",\"margin\":"     + _D(margin, 2)
        + ",\"free_margin\":" + _D(free_mrg, 2)
        + ",\"hedging\":"    + (hedging ? "true" : "false") + "}");
}


//+------------------------------------------------------------------+
//| Add symbol to streaming list                                     |
//+------------------------------------------------------------------+
void _SubscribeSymbol(string sym)
{
    for(int i = 0; i < ArraySize(_symbols); i++)
        if(_symbols[i] == sym) return;
    int sz = ArraySize(_symbols);
    ArrayResize(_symbols, sz + 1);
    _symbols[sz] = sym;
    SymbolSelect(sym, true);
}


//+------------------------------------------------------------------+
//| Live bars: add/remove a (symbol,tf) subscription, and push the    |
//| currently-FORMING bar (index 0) each cycle so the app updates the |
//| last candle in real time (and picks up new bars on rollover).     |
//+------------------------------------------------------------------+
void _SubscribeBars(string sym, string tf)
{
    for(int i = 0; i < ArraySize(_bar_symbols); i++)
        if(_bar_symbols[i] == sym && _bar_tfs[i] == tf) return;   // already subscribed
    int sz = ArraySize(_bar_symbols);
    ArrayResize(_bar_symbols, sz + 1);
    ArrayResize(_bar_tfs,     sz + 1);
    _bar_symbols[sz] = sym;
    _bar_tfs[sz]     = tf;
    SymbolSelect(sym, true);
}

void _UnsubscribeBars(string sym, string tf)
{
    int n = ArraySize(_bar_symbols);
    for(int i = 0; i < n; i++)
    {
        if(_bar_symbols[i] == sym && _bar_tfs[i] == tf)
        {
            for(int j = i; j < n - 1; j++) { _bar_symbols[j] = _bar_symbols[j + 1]; _bar_tfs[j] = _bar_tfs[j + 1]; }
            ArrayResize(_bar_symbols, n - 1);
            ArrayResize(_bar_tfs,     n - 1);
            return;
        }
    }
}

void _PushLiveBars()
{
    for(int i = 0; i < ArraySize(_bar_symbols); i++)
    {
        string sym = _bar_symbols[i];
        string tf  = _bar_tfs[i];
        ENUM_TIMEFRAMES period = _PeriodFromStr(tf);
        MqlRates rates[];
        ArraySetAsSeries(rates, true);          // index 0 = current forming bar
        if(CopyRates(sym, period, 0, 1, rates) <= 0) continue;
        int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
        _Send("{\"type\":\"bar\""
            + ",\"symbol\":\"" + sym + "\""
            + ",\"tf\":\""     + tf + "\""
            + ",\"time\":"     + _I(_ToUTC((long)rates[0].time))
            + ",\"open\":"     + _D(rates[0].open,  digits)
            + ",\"high\":"     + _D(rates[0].high,  digits)
            + ",\"low\":"      + _D(rates[0].low,   digits)
            + ",\"close\":"    + _D(rates[0].close, digits)
            + ",\"volume\":"   + _I((long)rates[0].tick_volume)
            + ",\"live\":true}");
    }
}


//+------------------------------------------------------------------+
//| Depth of market (DOM). subscribe -> MarketBookAdd + snapshot;     |
//| OnBookEvent pushes updates. Emits one message with bids[]+asks[]. |
//| NOTE: many brokers do NOT publish a book for forex -- MarketBookAdd|
//| may fail or MarketBookGet return empty. depth is an OPTIONAL cap.  |
//+------------------------------------------------------------------+
bool _SubscribeDepth(string sym)
{
    for(int i = 0; i < ArraySize(_depth_symbols); i++)
        if(_depth_symbols[i] == sym) return true;   // already subscribed
    if(!MarketBookAdd(sym)) return false;
    int sz = ArraySize(_depth_symbols);
    ArrayResize(_depth_symbols, sz + 1);
    _depth_symbols[sz] = sym;
    _PushDepth(sym);   // immediate snapshot
    return true;
}

void _UnsubscribeDepth(string sym)
{
    int n = ArraySize(_depth_symbols);
    for(int i = 0; i < n; i++)
        if(_depth_symbols[i] == sym)
        {
            MarketBookRelease(sym);
            for(int j = i; j < n - 1; j++) _depth_symbols[j] = _depth_symbols[j + 1];
            ArrayResize(_depth_symbols, n - 1);
            return;
        }
}

void _PushDepth(string sym)
{
    MqlBookInfo book[];
    if(!MarketBookGet(sym, book)) return;
    int n = ArraySize(book);
    int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
    string bids = "", asks = "";
    for(int i = 0; i < n; i++)
    {
        double vol  = (book[i].volume_real > 0) ? book[i].volume_real : (double)book[i].volume;
        string cell = "{\"price\":" + _D(book[i].price, digits) + ",\"qty\":" + _D(vol, 2) + "}";
        ENUM_BOOK_TYPE bt = book[i].type;
        if(bt == BOOK_TYPE_BUY || bt == BOOK_TYPE_BUY_MARKET)
            bids += (StringLen(bids) > 0 ? "," : "") + cell;
        else if(bt == BOOK_TYPE_SELL || bt == BOOK_TYPE_SELL_MARKET)
            asks += (StringLen(asks) > 0 ? "," : "") + cell;
    }
    _Send("{\"type\":\"depth\",\"symbol\":\"" + sym + "\",\"bids\":[" + bids + "],\"asks\":[" + asks + "]}");
}



//+------------------------------------------------------------------+
//| Send a JSON line to the server                                   |
//+------------------------------------------------------------------+
void _Send(const string json)
{
    if(_socket == INVALID_HANDLE) return;
    string msg = json + "\n";
    uchar  buf[];
    int    len = StringToCharArray(msg, buf, 0, WHOLE_ARRAY, CP_UTF8);
    if(len > 1)
    {
        if(SocketSend(_socket, buf, len - 1) < 0)
        {
            Print("MT5_Bridge: send error, disconnecting");
            _Disconnect();
            return;
        }
    }
    if(InpDebug) Print("MT5_Bridge tx: ", json);
}


//+------------------------------------------------------------------+
//| Send NAK ack                                                     |
//+------------------------------------------------------------------+
void _Nak(long id, string err)
{
    _Send("{\"type\":\"ack\",\"id\":" + _I(id) + ",\"ok\":false,\"error\":\"" + err + "\"}");
}


//+------------------------------------------------------------------+
//| Best filling mode for symbol                                     |
//+------------------------------------------------------------------+
ENUM_ORDER_TYPE_FILLING _FillingMode(string sym)
{
    uint filling = (uint)SymbolInfoInteger(sym, SYMBOL_FILLING_MODE);
    if((filling & SYMBOL_FILLING_IOC) != 0) return ORDER_FILLING_IOC;
    if((filling & SYMBOL_FILLING_FOK) != 0) return ORDER_FILLING_FOK;
    return ORDER_FILLING_RETURN;
}


//+------------------------------------------------------------------+
//| JSON extraction helpers (flat JSON only)                         |
//+------------------------------------------------------------------+

string _JStr(const string json, const string key)
{
    string search = "\"" + key + "\":\"";
    int pos = StringFind(json, search);
    if(pos < 0) return "";
    pos += StringLen(search);
    int end = StringFind(json, "\"", pos);
    if(end < 0) return "";
    return StringSubstr(json, pos, end - pos);
}

double _JDbl(const string json, const string key)
{
    string search = "\"" + key + "\":";
    int pos = StringFind(json, search);
    if(pos < 0) return 0.0;
    pos += StringLen(search);
    int end = pos;
    int len = StringLen(json);
    while(end < len)
    {
        ushort c = StringGetCharacter(json, end);
        if(c == ',' || c == '}' || c == ' ') break;
        end++;
    }
    return StringToDouble(StringSubstr(json, pos, end - pos));
}

long _JLng(const string json, const string key) { return (long)_JDbl(json, key); }


//+------------------------------------------------------------------+
//| Format helpers                                                   |
//+------------------------------------------------------------------+
string _D(double v, int digits) { return DoubleToString(v, digits); }
string _I(long   v)             { return IntegerToString(v); }

// Escape a raw string for embedding in a JSON string literal. Backslash FIRST, then quote -- order
// matters or the quote-escape's own backslash gets doubled. Needed for SYMBOL_PATH (backslash-delimited)
// and descriptions that may carry a quote. The other _Send call sites embed clean codes/numbers, so they
// skip this by design.
string _JsonEsc(string s)
{
    StringReplace(s, "\\", "\\\\");
    StringReplace(s, "\"", "\\\"");
    return s;
}

// Convert a broker server-time timestamp to UTC. DEAL_TIME / tick.time / bar time are in
// broker server time; the app expects pure UTC. The server->UTC offset is derived from
// TimeTradeServer() (calculated current server time -- advances with the PC clock, DST-aware),
// NOT TimeCurrent() (the LAST TICK's time, which lags/freezes when a symbol is quiet and used to
// leak that lag into every converted timestamp -- e.g. M5 bars landing at :02 instead of :00).
long _ToUTC(long server_ts)     { return server_ts - (long)(TimeTradeServer() - TimeGMT()); }
// Inverse: the app sends request ranges (get_bars / get_history from/to) in UTC, but CopyRates and
// HistorySelect work in SERVER time. Convert UTC->server before calling them, or a "to = now UTC"
// range is read as server time and fetches only up to (now - offset) -- the missing recent bars.
long _FromUTC(long utc_ts)      { return utc_ts + (long)(TimeTradeServer() - TimeGMT()); }
