// src/CommunicationTest.tsx
import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

type QuestionColor = "blauw" | "rood" | "groen" | "geel";

type Question = {
  id: number;
  number: number;
  color: QuestionColor;
  cluster: string;
  question: string;
};

type Step = "start" | "questions" | "result";

type Scores = {
  total: number;
  blauw: number;
  rood: number;
  groen: number;
  geel: number;
};

const answerOptions = [
  { value: 1, label: "Niet herkenbaar" },
  { value: 2, label: "Enigszins herkenbaar" },
  { value: 3, label: "Heel herkenbaar" },
];

export function CommunicationTest() {
  const [step, setStep] = useState<Step>("start");

  const [participant, setParticipant] = useState({
    full_name: "",
    email: "",
    organization: "",
    role: "",
  });

  const [participantId, setParticipantId] = useState<number | null>(null);
  const [assessmentId, setAssessmentId] = useState<number | null>(null);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});

  const [scores, setScores] = useState<Scores | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Helper om scores te berekenen
  function calculateScores(
    qs: Question[],
    ans: Record<number, number>
  ): Scores {
    const base: Scores = {
      total: 0,
      blauw: 0,
      rood: 0,
      groen: 0,
      geel: 0,
    };

    return qs.reduce((acc, q) => {
      const value = ans[q.id] ?? 0;
      acc.total += value;
      acc[q.color] += value;
      return acc;
    }, base);
  }

  function getDominantColor(scores: Scores | null): QuestionColor | null {
    if (!scores) return null;
    const entries: [QuestionColor, number][] = [
      ["blauw", scores.blauw],
      ["rood", scores.rood],
      ["groen", scores.groen],
      ["geel", scores.geel],
    ];
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][0];
  }

  // Test starten: participant + assessment aanmaken
  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!participant.full_name || !participant.email) {
      setError("Naam en e-mail zijn verplicht.");
      return;
    }

    setLoading(true);
    try {
      const { data: p, error: pErr } = await supabase
        .from("communication_participants")
        .upsert(
          {
            full_name: participant.full_name,
            email: participant.email,
            organization: participant.organization || null,
            role: participant.role || null,
          },
          { onConflict: "email" }
        )
        .select("id")
        .single();

      if (pErr || !p) {
        console.error(pErr);
        setError("Kon deelnemer niet opslaan.");
        return;
      }

      setParticipantId(p.id);

      const { data: a, error: aErr } = await supabase
        .from("communication_assessments")
        .insert({ participant_id: p.id, status: "in_progress" })
        .select("id")
        .single();

      if (aErr || !a) {
        console.error(aErr);
        setError("Kon test-sessie niet starten.");
        return;
      }

      setAssessmentId(a.id);
      setStep("questions");
    } finally {
      setLoading(false);
    }
  }

  // Vragen laden zodra we naar de vragen-stap gaan
  useEffect(() => {
    if (step !== "questions") return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    supabase
      .from("communication_questions")
      .select("id, number, color, cluster, question")
      .order("number")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error(error);
          setError("Kon de vragen niet laden.");
          setLoading(false);
          return;
        }
        setQuestions((data ?? []) as Question[]);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [step]);

  // Antwoord wijzigen
  function handleAnswerChange(questionId: number, value: number) {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: value,
    }));
  }

  // Antwoorden versturen
  async function handleSubmit() {
    if (!assessmentId) {
      setError("Geen geldige test-sessie gevonden.");
      return;
    }
    if (questions.length === 0) {
      setError("Geen vragen geladen.");
      return;
    }

    const unanswered = questions.filter((q) => answers[q.id] == null);
    if (unanswered.length > 0) {
      setError(
        `Nog ${unanswered.length} vraag/vraagstukken niet beantwoord. Vul alle vragen in.`
      );
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rows = questions.map((q) => ({
        assessment_id: assessmentId,
        question_id: q.id,
        answer_value: answers[q.id],
      }));

      const { error: insertErr } = await supabase
        .from("communication_answers")
        .insert(rows);

      if (insertErr) {
        console.error(insertErr);
        setError("Kon de antwoorden niet opslaan.");
        return;
      }

      const newScores = calculateScores(questions, answers);
      setScores(newScores);

      const { error: updateErr } = await supabase
        .from("communication_assessments")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          total_score: newScores.total,
          blue_score: newScores.blauw,
          red_score: newScores.rood,
          green_score: newScores.groen,
          yellow_score: newScores.geel,
        })
        .eq("id", assessmentId);

      if (updateErr) {
        console.error(updateErr);
        // geen harde fout: antwoorden staan al in de DB
      }

      setStep("result");
    } finally {
      setLoading(false);
    }
  }

  // --- RENDER ---

  // START-SCHERM
  if (step === "start") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-md p-6 md:p-8">
          <h1 className="text-2xl font-semibold mb-2">
            Communicatiestijl Test
          </h1>
          <p className="text-slate-600 text-sm mb-6">
            Vul je gegevens in om de test te starten. Er zijn geen goede of
            foute antwoorden, alleen wat bij jou past.
          </p>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleStart} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Naam*</label>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={participant.full_name}
                onChange={(e) =>
                  setParticipant((prev) => ({
                    ...prev,
                    full_name: e.target.value,
                  }))
                }
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">E-mail*</label>
              <input
                type="email"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={participant.email}
                onChange={(e) =>
                  setParticipant((prev) => ({
                    ...prev,
                    email: e.target.value,
                  }))
                }
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Organisatie
              </label>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={participant.organization}
                onChange={(e) =>
                  setParticipant((prev) => ({
                    ...prev,
                    organization: e.target.value,
                  }))
                }
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Rol</label>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={participant.role}
                onChange={(e) =>
                  setParticipant((prev) => ({
                    ...prev,
                    role: e.target.value,
                  }))
                }
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? "Bezig..." : "Start de test"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // VRAGEN-SCHERM
  if (step === "questions") {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold mb-1">
              Beantwoord alle vragen
            </h2>
            <p className="text-sm text-slate-600">
              Kies per stelling in hoeverre deze bij jou past.
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {loading && questions.length === 0 && (
            <p className="text-slate-600 text-sm">Vragen worden geladen...</p>
          )}

          {!loading && questions.length > 0 && (
            <>
              <div className="space-y-4">
                {questions.map((q) => (
                  <div
                    key={q.id}
                    className="border border-slate-200 rounded-xl bg-white px-4 py-3 shadow-sm"
                  >
                    <div className="mb-3">
                      <span className="font-semibold mr-1">{q.number}.</span>
                      <span>{q.question}</span>
                    </div>

                    <div className="flex flex-wrap gap-4 text-sm">
                      {answerOptions.map((opt) => (
                        <label
                          key={opt.value}
                          className="inline-flex items-center gap-2"
                        >
                          <input
                            type="radio"
                            name={`q-${q.id}`}
                            checked={answers[q.id] === opt.value}
                            onChange={() =>
                              handleAnswerChange(q.id, opt.value)
                            }
                          />
                          <span>{opt.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-8 flex justify-end">
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="inline-flex items-center rounded-full bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
                >
                  {loading ? "Opslaan..." : "Verstuur antwoorden"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // RESULTAAT-SCHERM
  if (step === "result" && scores) {
    const dominant = getDominantColor(scores);
    const colorLabels: Record<QuestionColor, string> = {
      blauw: "Blauw – Analytisch & logisch",
      rood: "Rood – Direct & daadkrachtig",
      groen: "Groen – Stabiel & betrouwbaar",
      geel: "Geel – Enthousiast & sociaal",
    };

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-md p-6 md:p-8">
          <h2 className="text-2xl font-semibold mb-2">
            Bedankt voor het invullen!
          </h2>
          <p className="text-sm text-slate-600 mb-6">
            Hieronder zie je een samenvatting van jouw communicatiestijl.
          </p>

          <div className="grid grid-cols-2 gap-3 text-sm mb-6">
            <div className="col-span-2 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
              <span className="font-medium">Totale score</span>
              <span className="font-semibold">{scores.total}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-blue-50 px-3 py-2">
              <span>Blauw (analytisch)</span>
              <span className="font-semibold">{scores.blauw}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-red-50 px-3 py-2">
              <span>Rood (daadkrachtig)</span>
              <span className="font-semibold">{scores.rood}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2">
              <span>Groen (stabiel)</span>
              <span className="font-semibold">{scores.groen}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2">
              <span>Geel (enthousiast)</span>
              <span className="font-semibold">{scores.geel}</span>
            </div>
          </div>

          {dominant && (
            <div className="mb-6 rounded-xl bg-slate-900 px-4 py-3 text-sm text-slate-50">
              <p className="uppercase text-xs tracking-wide text-slate-400 mb-1">
                Dominante kleur
              </p>
              <p className="font-semibold">{colorLabels[dominant]}</p>
            </div>
          )}

          <p className="text-xs text-slate-500">
            Je scores geven een indicatie van jouw voorkeursstijl. In gesprekken
            kun je hierop inspelen door kleuren van anderen te herkennen en je
            communicatie daarop af te stemmen.
          </p>
        </div>
      </div>
    );
  }

  // fallback (zou normaal niet gebeuren)
  return null;
}
