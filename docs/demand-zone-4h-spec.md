# نموذج Demand Zone مبني على شموع 4H

هذا النموذج يستبدل المعادلة النسبية الحالية (`price × 0.96/0.99`) بمنطقة مبنية على شموع 4 ساعات. الكود التالي **مرجع Python قابل للاختبار**، ثم يجب نقل المنطق إلى خدمة الخادم الحالية المكتوبة بـ TypeScript قبل تفعيله في Telegram.

## 1. مصدر البيانات

الخيار العملي هو **Finnhub Stock Candles**:

```text
GET https://finnhub.io/api/v1/stock/candle
  ?symbol=AMAT
  &resolution=60
  &from=<unix_seconds>
  &to=<unix_seconds>
  &token=<FINNHUB_API_KEY>
```

Finnhub يوفر شموعاً زمنية شائعة مثل 60 دقيقة. لذلك يجلب الكود 60-minute OHLCV ثم يجمّع كل أربع شموع مكتملة إلى شمعة 4H. يجب استخدام مفتاح API من متغير بيئة فقط، وعدم وضعه داخل الكود.

> مهم: لا تستخدم الشمعة الحالية غير المكتملة في توليد المنطقة أو تأكيدها. آخر شمعة مستخدمة يجب أن تكون مغلقة بالكامل.

## 2. كود Python

```python
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

import pandas as pd
import requests
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
FINNHUB_URL = "https://finnhub.io/api/v1/stock/candle"


@dataclass(frozen=True)
class Candle:
    timestamp: pd.Timestamp
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True)
class DemandZone:
    symbol: str
    demand_low: float       # Lowest Low of the selected magnet/cluster
    demand_high: float      # Upper edge of the real body / accumulation cluster
    source_candle_time: str
    confirmation_close: float
    status: Literal["confirmed", "unconfirmed"]
    break_type: Literal["none", "wick_break", "confirmed_close_break"]
    provider: str


def get_finnhub_60m(symbol: str, lookback_days: int = 30) -> pd.DataFrame:
    token = os.environ["FINNHUB_API_KEY"]
    now = datetime.now(timezone.utc)
    start = int((now - timedelta(days=lookback_days)).timestamp())
    end = int(now.timestamp())

    response = requests.get(
        FINNHUB_URL,
        params={
            "symbol": symbol.upper(),
            "resolution": "60",
            "from": start,
            "to": end,
            "token": token,
        },
        timeout=15,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("s") != "ok":
        raise RuntimeError(f"Finnhub candle response is not usable: {payload.get('s')}")

    frame = pd.DataFrame(
        {
            "open": payload["o"],
            "high": payload["h"],
            "low": payload["l"],
            "close": payload["c"],
            "volume": payload["v"],
        },
        index=pd.to_datetime(payload["t"], unit="s", utc=True),
    )
    frame = frame.tz_convert(NY).sort_index()

    # Keep regular US equity hours. This also avoids pre-market/post-market
    # prints changing the demand-zone low.
    frame = frame.between_time("09:30", "16:00", inclusive="left")
    return frame.dropna()


def aggregate_60m_to_4h(hourly: pd.DataFrame) -> pd.DataFrame:
    """Aggregate four completed regular-session 60m bars per trading day.

    The final group may contain three bars because a US session is 6.5 hours.
    It is retained as a partial final session block only if it has at least
    three bars; production can instead discard it until the next full block.
    """
    rows: list[dict] = []
    for session_date, day in hourly.groupby(hourly.index.date):
        day = day.sort_index()
        for start in range(0, len(day), 4):
            group = day.iloc[start:start + 4]
            if len(group) < 3:
                continue
            rows.append(
                {
                    "timestamp": group.index[-1],
                    "open": float(group["open"].iloc[0]),
                    "high": float(group["high"].max()),
                    "low": float(group["low"].min()),
                    "close": float(group["close"].iloc[-1]),
                    "volume": float(group["volume"].sum()),
                    "bars": len(group),
                }
            )
    result = pd.DataFrame(rows)
    if result.empty:
        raise RuntimeError("No completed 4H bars were created")
    result = result.set_index("timestamp").sort_index()
    # At runtime, exclude a block whose ending timestamp is still in the future.
    now_ny = pd.Timestamp.now(tz=NY)
    return result[result.index < now_ny]


def add_candle_features(frame: pd.DataFrame) -> pd.DataFrame:
    out = frame.copy()
    out["body_low"] = out[["open", "close"]].min(axis=1)
    out["body_high"] = out[["open", "close"]].max(axis=1)
    out["body"] = (out["close"] - out["open"]).abs()
    out["range"] = out["high"] - out["low"]
    out["lower_wick"] = out["body_low"] - out["low"]
    out["upper_wick"] = out["high"] - out["body_high"]
    out["body_ratio"] = out["body"] / out["range"].replace(0, pd.NA)
    out["volume_median20"] = out["volume"].rolling(20, min_periods=5).median()
    return out.dropna(subset=["range", "body_ratio"])


def is_magnet_or_accumulation(row: pd.Series) -> bool:
    """Conservative rejection/accumulation heuristic.

    Tune these thresholds with a historical validation set; they are not
    universal market laws.
    """
    if row["range"] <= 0:
        return False
    long_lower_wick = row["lower_wick"] >= max(row["body"] * 1.5, row["range"] * 0.35)
    compact_body = row["body_ratio"] <= 0.55
    volume_support = pd.isna(row["volume_median20"]) or row["volume"] >= row["volume_median20"] * 0.8
    return bool(long_lower_wick and compact_body and volume_support)


def find_confirmed_zone(frame: pd.DataFrame, symbol: str, lookback: int = 30) -> DemandZone | None:
    data = add_candle_features(frame).tail(lookback)
    if len(data) < 5:
        return None

    candidates = [idx for idx, row in data.iterrows() if is_magnet_or_accumulation(row)]
    if not candidates:
        return None

    # Prefer the most recent candidate, but only after its confirmation candle
    # closes above the candidate's real-body high.
    for candidate_time in reversed(candidates):
        pos = data.index.get_loc(candidate_time)
        candidate = data.iloc[pos]
        confirmation = None
        for j in range(pos + 1, min(pos + 4, len(data))):
            following = data.iloc[j]
            if following["close"] > candidate["body_high"]:
                confirmation = following
                break
        if confirmation is None:
            continue

        # Demand low = Lowest Low of the magnet candle and nearby accumulation
        # cluster. Demand high = highest real-body edge of that cluster.
        cluster = data.iloc[max(0, pos - 2):pos + 1]
        demand_low = float(cluster["low"].min())
        demand_high = float(cluster["body_high"].max())
        return DemandZone(
            symbol=symbol.upper(),
            demand_low=demand_low,
            demand_high=demand_high,
            source_candle_time=candidate_time.isoformat(),
            confirmation_close=float(confirmation["close"]),
            status="confirmed",
            break_type="none",
            provider="Finnhub 60m aggregated to 4H",
        )
    return None


def classify_break(zone: DemandZone, candle_low: float, candle_close: float) -> str:
    """Differentiate a wick sweep from a confirmed closing breakdown."""
    if candle_low < zone.demand_low and candle_close >= zone.demand_low:
        return "wick_break"              # sweep below the low, reclaimed by close
    if candle_close < zone.demand_low:
        return "confirmed_close_break"   # invalidate zone only on closing basis
    return "none"


if __name__ == "__main__":
    symbol = "AMAT"
    hourly = get_finnhub_60m(symbol)
    four_h = aggregate_60m_to_4h(hourly)
    zone = find_confirmed_zone(four_h, symbol)
    print(zone)
```

## 3. قواعد الاعتماد والتنبيه

- **`demandLow`** = أدنى `low` داخل شمعة الماجنت أو مجموعة التجميع المختارة.
- **`demandHigh`** = أعلى حد لجسم الشموع في المجموعة (`body_high`) وليس أعلى ذيل.
- لا تعتمد المنطقة قبل وجود شمعة لاحقة تغلق فوق `body_high`.
- هبوط السعر تحت `demandLow` بذيل فقط = `wick_break`، ولا يلغي المنطقة.
- إغلاق شمعة 4H تحت `demandLow` = `confirmed_close_break`، ويلغي المنطقة أو يضعها في حالة invalidated.
- تنبيه الدخول يجب أن يستخدم شمعة/سعر مكتملين وأن يبقى شرطه:

```text
DemandLow <= CurrentPrice <= DemandHigh
```

## 4. طريقة دمجها في Signal Desk

1. إنشاء خدمة `candleData` لجلب OHLCV 60m ودمجها إلى 4H.
2. استبدال السطر الحالي في `server/radar.ts`:

```ts
const demandLow = row.price * 0.96;
const demandHigh = row.price * 0.99;
```

بنتيجة `findConfirmedZone`، مع عدم إنشاء فرصة إذا لم توجد منطقة مؤكدة.
3. حفظ `sourceCandleTime`, `confirmationClose`, `zoneStatus`, و`breakType` في `radar_opportunities`.
4. تشغيل الفحص بعد إغلاق شمعة 4H، وليس كل دقيقة لتوليد منطقة جديدة.
5. إبقاء Heartbeat Telegram كل دقيقة للتنبيه عند دخول السعر المنطقة، لكن لا يعيد حساب المنطقة كل دقيقة.
6. إضافة اختبار تاريخي out-of-sample؛ لا تضبط نسب الذيل والجسم على نفس البيانات التي ستقيس عليها الأداء.

## 5. ملاحظات مهمة

- بيانات 4H المجمعة من 60m ليست مطابقة بالضرورة لشموع TradingView إذا اختلف توقيت بداية الجلسة أو معالجة الجلسات الجزئية؛ يجب تثبيت timezone والـ session policy.
- الأسهم قد تعلن تجزئة أو corporate action؛ استخدم سلسلة سعر موحدة ومعلّمة (raw أو split-adjusted) ولا تخلط بينهما.
- إذا فشل Finnhub، يمكن إضافة Yahoo/Manus Data API كاحتياطي، لكن يجب تسجيل المصدر ووقت الجلب والفاصل الزمني؛ لا تعتبر أي قيمة قديمة إشارة لحظية.
- هذه خوارزمية بحثية وليست ضماناً لنجاح منطقة الطلب. يلزم backtest وforward test قبل تفعيلها على Telegram الإنتاجي.
