import React, { useEffect, useMemo, useState } from "react";

// ====== 設定（必要に応じて増やしてOK）======
const pitchTypes = ["ライズ", "ドロップ", "チェンジ", "カット", "チェンドロ", "チェンライ"];
const pitchOutcomes = ["ボール", "見逃し", "空振り", "ファウル", "インプレー", "四球", "死球", "その他"];
const atBatResults = [
  "空振り三振",
  "見逃し三振",
  "四球",
  "死球",
  "単打",
  "二塁打",
  "三塁打",
  "本塁打",
  "ゴロアウト",
  "フライアウト",
  "ライナーアウト",
  "犠打",
  "犠飛",
  "エラー",
  "FC",
  "併殺",
  "その他",
];
const battedBallDirections = ["なし", "左", "中", "右"];
// 走者状況（8択）
const runnerOptions = ["なし", "一塁", "二塁", "三塁", "一二塁", "一三塁", "二三塁", "満塁"];

// アウトカウント（0〜2）
const outOptions = ["0", "1", "2"];

const STORAGE_KEY = "teamBattingLog_v1";

// ====== ユーティリティ ======
function todayYYYYMMDD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function escapeCSV(value) {
  const s = String(value ?? "");
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadTextFile(filename, text) {
  const BOM = "\uFEFF"; // ★Excel対策（UTF-8 BOM）
  const blob = new Blob([BOM + text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * ====== BSカウント計算 ======
 * - 打席開始は必ず 0-0
 * - ボール: B+1（最大3）
 * - 見逃し/空振り: S+1（最大2）
 * - ファウル: S<2 のときだけ S+1（2スト以降は増えない）
 * - 四球/死球/インプレー/その他: 判定は出すが、カウント更新は安全側で基本しない（四球はボール扱いに含める）
 */
function getBSJudgeAndNextCount(pitchOutcome, b, s) {
  const outcome = String(pitchOutcome || "");

  if (outcome === "ボール" || outcome === "四球") {
    const nb = Math.min(b + 1, 3);
    return { bsJudge: "ボール", nextB: nb, nextS: s };
  }

  if (outcome === "死球") {
    return { bsJudge: "死球", nextB: b, nextS: s };
  }

  if (outcome === "見逃し" || outcome === "空振り") {
    const ns = Math.min(s + 1, 2);
    return { bsJudge: "ストライク", nextB: b, nextS: ns };
  }

  if (outcome === "ファウル") {
    const ns = s < 2 ? s + 1 : s;
    return { bsJudge: "ファウル", nextB: b, nextS: ns };
  }

  if (outcome === "インプレー") {
    return { bsJudge: "インプレー", nextB: b, nextS: s };
  }

  return { bsJudge: outcome || "その他", nextB: b, nextS: s };
}

// ★Excelが「1-1」を日付にするのを防ぐ（先頭にアポストロフィ）
function formatBSCountForExcel(b, s) {
  return `'${b}-${s}`;
}

export default function App() {
  // ====== 入力：試合共通っぽい項目（打席ごとにコピーされる） ======
  const [date, setDate] = useState(todayYYYYMMDD());
  const [gameName, setGameName] = useState("");
  const [matchName, setMatchName] = useState(""); 
  const [inning, setInning] = useState(1);
  const [pitcherName, setPitcherName] = useState("");
  const [pitcherHand, setPitcherHand] = useState("右");

  // ====== 入力：打者（打席ごと） ======
  const [batterOrder, setBatterOrder] = useState(1);
  const [batterName, setBatterName] = useState("");
  const [batterSide, setBatterSide] = useState("右");
  const [outs, setOuts] = useState("0");
  const [runners, setRunners] = useState("なし");

  // ====== 入力：打席結果・打球方向 ======
  const [atBatResult, setAtBatResult] = useState(atBatResults[0]);
  const [battedBallDirection, setBattedBallDirection] = useState("なし"); 
  useEffect(() => {
  const noDirectionResults = [
    "空振り三振",
    "見逃し三振",
    "四球",
    "死球",
  ];

  if (noDirectionResults.includes(atBatResult)) {
    setBattedBallDirection("なし");
  }
}, [atBatResult]);

  const [paNote, setPaNote] = useState("");
  // ====== 入力：1球 ======
  const [pitchType, setPitchType] = useState(pitchTypes[0]);
  const [pitchOutcome, setPitchOutcome] = useState(pitchOutcomes[0]);
  const [pitchNote, setPitchNote] = useState("");

  // ====== 現在の打席（投球列） ======
  const [currentPitches, setCurrentPitches] = useState([]);

  // ====== 全打席ログ ======
  const [allPAs, setAllPAs] = useState([]);

  // ====== 編集モード ======
  const [editingId, setEditingId] = useState(null);

  // ====== 起動時に復元 ======
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) setAllPAs(parsed);
    } catch {
      // ignore
    }
  }, []);

  // ====== 保存 ======
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allPAs));
  }, [allPAs]);

  // ====== 追加：1球 ======
  const addPitch = () => {
    const nextNo = currentPitches.length + 1;
    const p = {
      pitchNo: nextNo,
      pitchType,
      pitchOutcome,
      note: pitchNote.trim(),
    };
    setCurrentPitches((prev) => [...prev, p]);
    setPitchNote("");
  };

  const updatePitch = (index, field, value) => {
    setCurrentPitches((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const deletePitch = (index) => {
    setCurrentPitches((prev) => {
      const copy = prev.filter((_, i) => i !== index);
      return copy.map((p, i) => ({ ...p, pitchNo: i + 1 }));
    });
  };

  // ====== 打席保存（新規 or 更新） ======
  const savePA = () => {
    if (!batterName.trim()) {
      alert("打者名を入力してください");
      return;
    }
    if (currentPitches.length === 0) {
      alert("少なくとも1球追加してください");
      return;
    }

    const pa = {
      id: editingId ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      date,
      matchName,
      gameName,
      inning: Number(inning),
      batterOrder: Number(batterOrder),
      batterName: batterName.trim(),
      batterSide,
      pitcherName: pitcherName.trim(),
      pitcherHand,
      atBatResult,
      battedBallDirection,
      pitches: currentPitches,
      paNote: paNote.trim(),
      outs: String(outs),
      runners: String(runners),
    };

    setAllPAs((prev) => {
      if (!editingId) return [...prev, pa];
      return prev.map((x) => (x.id === editingId ? pa : x));
    });

    setEditingId(null);
    setCurrentPitches([]);
    setAtBatResult(atBatResults[0]);
    setPaNote("");
    setBatterOrder((o) => (Number(o) === 9 ? 1 : Number(o) + 1));
  };

  const startEditPA = (pa) => {
    setEditingId(pa.id);
    setDate(pa.date || todayYYYYMMDD());
    setMatchName(pa.matchName || ""); 
    setGameName(pa.gameName || "");
    setInning(pa.inning ?? 1);
    setPitcherName(pa.pitcherName || "");
    setPitcherHand(pa.pitcherHand || "右");

    setBatterOrder(pa.batterOrder ?? 1);
    setBatterName(pa.batterName || "");
    setBatterSide(pa.batterSide || "右");

    setAtBatResult(pa.atBatResult || atBatResults[0]);
    setBattedBallDirection(pa.battedBallDirection || "中");
    setPaNote(pa.paNote || "");
    setCurrentPitches(pa.pitches || []);
    setOuts(pa.outs ?? "0");
    setRunners(pa.runners ?? "なし");
  };

  const deletePA = (id) => {
    if (!confirm("この打席を削除しますか？")) return;
    setAllPAs((prev) => prev.filter((x) => x.id !== id));
    if (editingId === id) {
      setEditingId(null);
      setCurrentPitches([]);
    }
  };

  const resetAll = () => {
    if (!confirm("全データをリセットしますか？（元に戻せません）")) return;
    localStorage.removeItem(STORAGE_KEY);
    setAllPAs([]);
    setCurrentPitches([]);
    setEditingId(null);
  };

  // ====== CSV出力（1球1行） + BSカウント ======
  const exportCSV = () => {
    if (allPAs.length === 0) {
      alert("データがありません");
      return;
    }

    // ★球結果列は削除（BS判定があるので不要）
    // ★打席結果は「最後の球の行だけ」出す
    const header = [
      "日付",
      "試合名",
      "試合相手",
      "イニング",
      "アウト",
      "走者",
      "打順",
      "打者",
      "打方",
      "投手",
      "投手利き",
      "打席結果",
      "打球方向",
      "BSカウント",
      "BS判定",
      "球数",
      "球種",
      "備考",
    ];

    const rows = [];
    rows.push(header.map(escapeCSV).join(","));

    const sorted = [...allPAs].sort((a, b) => {
      const ad = String(a.date || "");
      const bd = String(b.date || "");
      if (ad !== bd) return ad.localeCompare(bd);
      const ag = String(a.gameName || "");
      const bg = String(b.gameName || "");
      if (ag !== bg) return ag.localeCompare(bg);
      const ai = Number(a.inning ?? 0);
      const bi = Number(b.inning ?? 0);
      if (ai !== bi) return ai - bi;
      return Number(a.batterOrder ?? 0) - Number(b.batterOrder ?? 0);
    });

    for (const pa of sorted) {
      const common = {
        日付: pa.date ?? "",
        試合名: pa.matchName ?? "",
        試合相手: pa.gameName ?? "",
        イニング: pa.inning ?? "",
        アウト: pa.outs ?? "",
        走者: pa.runners ?? "",
        打順: pa.batterOrder ?? "",
        打者: pa.batterName ?? "",
        打方: pa.batterSide ?? "",
        投手: pa.pitcherName ?? "",
        投手利き: pa.pitcherHand ?? "",
      };

      let bCount = 0;
      let sCount = 0;

      const pitches = pa.pitches || [];
      const lastIndex = pitches.length - 1;

      pitches.forEach((p, idx) => {
        const bsCountStr = formatBSCountForExcel(bCount, sCount); // ★日付化防止
        const { bsJudge, nextB, nextS } = getBSJudgeAndNextCount(p.pitchOutcome, bCount, sCount);

        const note = [p.note, pa.paNote].filter(Boolean).join(" / ");

        // ★打席結果は最後の球の行だけ
        const atBatResultCell = idx === lastIndex ? (pa.atBatResult ?? "") : "";
        const battedDirCell = 
          idx === lastIndex && pa.battedBallDirection !== "なし"
            ? pa.battedBallDirection
            : "";

        const row = [
          common.日付,
          common.試合名,
          common.試合相手,
          common.イニング,
          common.アウト,
          common.走者,
          common.打順,
          common.打者,
          common.打方,
          common.投手,
          common.投手利き,
          atBatResultCell,
          battedDirCell,
          bsCountStr,
          bsJudge,
          p.pitchNo ?? "",
          p.pitchType ?? "",
          note,
        ];
        rows.push(row.map(escapeCSV).join(","));

        bCount = nextB;
        sCount = nextS;
      });
    }

    const csvText = rows.join("\n");
    const filename = `batting_log_${todayYYYYMMDD()}.csv`;
    downloadTextFile(filename, csvText);
  };

  // ====== 打者別に見たい用（簡単フィルタ） ======
  const [filterBatter, setFilterBatter] = useState("");
  const filteredPAs = useMemo(() => {
    const q = filterBatter.trim();
    if (!q) return allPAs;
    return allPAs.filter((pa) => String(pa.batterName || "").includes(q));
  }, [allPAs, filterBatter]);

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: "0 auto", fontFamily: "sans-serif" }}>
      <h1>⚾ 打席ログ</h1>

      <div className="topBar">
        <button onClick={exportCSV}>⬇️ CSV出力</button>
        <button onClick={resetAll}>🗑️ 全データリセット</button>
        <div style={{ marginLeft: "auto" }}>
          打者フィルタ：
          <input
            value={filterBatter}
            onChange={(e) => setFilterBatter(e.target.value)}
            placeholder="打者名を検索"
            style={{ marginLeft: 8 }}
          />
        </div>
      </div>

      <hr />

      <h2>{editingId ? "✏️ 打席を編集" : "➕ 新しい打席を記録"}</h2>

      <div className="formGrid">
        <label>
          日付
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "100%" }} />
        </label>

        <label>
          試合名
          <input
           value={matchName}
           onChange={(e) => setMatchName(e.target.value)}
           placeholder="例：練習試合/春リーグ"
           style={{ width: "100%" }}
          />
        </label>

        <label>
          試合相手
          <input value={gameName} onChange={(e) => setGameName(e.target.value)} placeholder="例：慶應大学" style={{ width: "100%" }} />
        </label>

        <label>
          イニング
          <input type="number" min={1} max={99} value={inning} onChange={(e) => setInning(e.target.value)} style={{ width: "100%" }} />
        </label>

        <div>
          投手
          <div style={{ display: "flex", gap: 8 }}>
            <input value={pitcherName} onChange={(e) => setPitcherName(e.target.value)} placeholder="投手名" style={{ flex: 1 }} />
            <select value={pitcherHand} onChange={(e) => setPitcherHand(e.target.value)}>
              <option>右</option>
              <option>左</option>
            </select>
          </div>
        </div>

        <label>
          打順
          <input type="number" min={1} max={9} value={batterOrder} onChange={(e) => setBatterOrder(e.target.value)} style={{ width: "100%" }} />
        </label>

        <div>
          打者
          <div style={{ display: "flex", gap: 8 }}>
            <input value={batterName} onChange={(e) => setBatterName(e.target.value)} placeholder="打者名" style={{ flex: 1 }} />
            <select value={batterSide} onChange={(e) => setBatterSide(e.target.value)}>
              <option>右</option>
              <option>左</option>
            </select>
          </div>
        </div>

        <label>
          アウト
          <select value={outs} onChange={(e) => setOuts(e.target.value)} style={{ width: "100%" }}>
            {outOptions.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>

        <label>
          走者
          <select value={runners} onChange={(e) => setRunners(e.target.value)} style={{ width: "100%" }}>
            {runnerOptions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>

<label>
  打席結果（最終）
  <select value={atBatResult} onChange={(e) => setAtBatResult(e.target.value)} style={{ width: "100%" }}>
    {atBatResults.map((r) => (
      <option key={r} value={r}>{r}</option>
    ))}
  </select>
</label>

<label>
  打球方向
  <select value={battedBallDirection} onChange={(e) => setBattedBallDirection(e.target.value)} style={{ width: "100%" }}>
    {battedBallDirections.map((d) => (
      <option key={d} value={d}>{d}</option>
    ))}
  </select>
</label>

        <label style={{ gridColumn: "span 4" }}>
          打席メモ（任意）
          <input value={paNote} onChange={(e) => setPaNote(e.target.value)} placeholder="例：初球から変化球攻め" style={{ width: "100%" }} />
        </label>
      </div>

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <h3>➕ 1球追加</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label>
            球種：
            <select value={pitchType} onChange={(e) => setPitchType(e.target.value)} style={{ marginLeft: 6 }}>
              {pitchTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>

          <label>
            球結果：
            <select value={pitchOutcome} onChange={(e) => setPitchOutcome(e.target.value)} style={{ marginLeft: 6 }}>
              {pitchOutcomes.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>

          <label style={{ flex: 1, minWidth: 260 }}>
            メモ：
            <input value={pitchNote} onChange={(e) => setPitchNote(e.target.value)} placeholder="例：高め、詰まった" style={{ marginLeft: 6, width: "80%" }} />
          </label>

          <button onClick={addPitch}>＋追加</button>
        </div>

        <div style={{ marginTop: 10 }}>
          <strong>現在の打席（{currentPitches.length}球）</strong>
          {currentPitches.length === 0 ? (
            <div style={{ color: "#666", marginTop: 6 }}>まだ1球も追加されていません</div>
          ) : (
            <ul style={{ marginTop: 8 }}>
              {currentPitches.map((p, i) => (
                <li key={i} style={{ marginBottom: 6 }}>
                  <b>{p.pitchNo}球目</b>{" "}
                  <select value={p.pitchType} onChange={(e) => updatePitch(i, "pitchType", e.target.value)} style={{ marginLeft: 6 }}>
                    {pitchTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>{" "}
                  <select value={p.pitchOutcome} onChange={(e) => updatePitch(i, "pitchOutcome", e.target.value)} style={{ marginLeft: 6 }}>
                    {pitchOutcomes.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>{" "}
                  <input value={p.note || ""} onChange={(e) => updatePitch(i, "note", e.target.value)} placeholder="メモ" style={{ marginLeft: 6 }} />
                  <button onClick={() => deletePitch(i)} style={{ marginLeft: 8 }}>削除</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button onClick={savePA} style={{ marginTop: 10 }}>
          {editingId ? "✅ 編集を保存" : "✅ この打席を保存"}
        </button>
        {editingId && (
          <button onClick={() => { setEditingId(null); setCurrentPitches([]); }} style={{ marginLeft: 10 }}>
            編集をやめる
          </button>
        )}
      </div>

      <hr style={{ margin: "18px 0" }} />

      <h2>📚 打席一覧（{filteredPAs.length}件）</h2>

      {filteredPAs.length === 0 ? (
        <div style={{ color: "#666" }}>まだデータがありません</div>
      ) : (
        <ul style={{ paddingLeft: 16 }}>
          {filteredPAs.map((pa) => (
            <li key={pa.id} style={{ marginBottom: 14, padding: 10, border: "1px solid #eee", borderRadius: 8 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <b>
                  {pa.date} / {pa.gameName || "（試合相手なし）"} / {pa.inning}回 / {pa.batterOrder}番 {pa.batterName}（{pa.batterSide}）
                </b>
                <span>vs 投手：{pa.pitcherName || "（不明）"}（{pa.pitcherHand || "右"}）</span>
                <span>結果：<b>{pa.atBatResult}</b></span>
                <span>方向：<b>{pa.battedBallDirection || "-"}</b></span>

                <div style={{ marginLeft: "auto" }}>
                  <button onClick={() => startEditPA(pa)}>編集</button>
                  <button onClick={() => deletePA(pa.id)} style={{ marginLeft: 8 }}>削除</button>
                </div>
              </div>

              <div style={{ marginTop: 8 }}>
                <div style={{ color: "#444" }}>
                  投球列： {(pa.pitches || []).map((p) => `${p.pitchNo}:${p.pitchType}-${p.pitchOutcome}`).join(" | ")}
                </div>
                {(pa.paNote || "").trim() && <div style={{ color: "#666", marginTop: 4 }}>メモ：{pa.paNote}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
