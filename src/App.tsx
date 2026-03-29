import React, { useState, useRef } from 'react';
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { 
  Upload, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  XCircle, 
  BarChart3, 
  ClipboardCheck,
  Loader2,
  ChevronRight,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

interface QuestionData {
  id: string;
  question: string;
  referenceAnswer: string;
  maxMarks: number;
}

interface StudentAnswer {
  id: string;
  answer: string;
}

interface EvaluationResult {
  questionId: string;
  questionText: string;
  studentAnswer: string;
  referenceAnswer: string;
  score: number;
  maxMarks: number;
  status: 'Correct' | 'Partially Correct' | 'Wrong';
  feedback: string;
}

interface Summary {
  totalScore: number;
  maxScore: number;
  correctCount: number;
  partialCount: number;
  wrongCount: number;
}

// --- App Component ---

export default function App() {
  const [teacherFile, setTeacherFile] = useState<File | null>(null);
  const [studentFile, setStudentFile] = useState<File | null>(null);
  const [questions, setQuestions] = useState<QuestionData[]>([]);
  const [studentAnswers, setStudentAnswers] = useState<StudentAnswer[]>([]);
  const [results, setResults] = useState<EvaluationResult[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [strictness, setStrictness] = useState<'Strict' | 'Balanced' | 'Flexible'>('Balanced');

  const teacherInputRef = useRef<HTMLInputElement>(null);
  const studentInputRef = useRef<HTMLInputElement>(null);

  // --- Parsing Logic ---

  const parseTeacherFile = async (file: File) => {
    const text = await file.text();
    const lines = text.split('\n');
    const parsedQuestions: QuestionData[] = [];
    let currentQ: Partial<QuestionData> = {};

    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('Q') && trimmed.includes(':')) {
        if (currentQ.id) parsedQuestions.push(currentQ as QuestionData);
        const [idPart, ...rest] = trimmed.split(':');
        currentQ = { 
          id: idPart.trim(), 
          question: rest.join(':').trim() 
        };
      } else if (trimmed.startsWith('A:')) {
        currentQ.referenceAnswer = trimmed.substring(2).trim();
      } else if (trimmed.startsWith('M:')) {
        currentQ.maxMarks = parseFloat(trimmed.substring(2).trim()) || 0;
      }
    });
    if (currentQ.id) parsedQuestions.push(currentQ as QuestionData);
    
    if (parsedQuestions.length === 0) {
      throw new Error("Invalid Teacher File format. Use Q1: Question, A: Answer, M: Marks.");
    }
    return parsedQuestions;
  };

  const parseStudentFile = async (file: File) => {
    const text = await file.text();
    const lines = text.split('\n');
    const parsedAnswers: StudentAnswer[] = [];
    
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('A') && trimmed.includes(':')) {
        const [idPart, ...rest] = trimmed.split(':');
        parsedAnswers.push({
          id: idPart.trim().replace('A', 'Q'), // Map A1 to Q1
          answer: rest.join(':').trim()
        });
      }
    });

    if (parsedAnswers.length === 0) {
      throw new Error("Invalid Student File format. Use A1: Answer text.");
    }
    return parsedAnswers;
  };

  // --- AI Evaluation Logic ---

  const evaluateAnswers = async () => {
    if (!teacherFile || !studentFile) return;

    setIsEvaluating(true);
    setError(null);
    setResults([]);

    try {
      const qData = await parseTeacherFile(teacherFile);
      const aData = await parseStudentFile(studentFile);
      
      setQuestions(qData);
      setStudentAnswers(aData);
      setProgress({ current: 0, total: qData.length });

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const model = "gemini-3-flash-preview";

      const evaluationResults: EvaluationResult[] = [];

      for (let i = 0; i < qData.length; i++) {
        const q = qData[i];
        const studentAns = aData.find(a => a.id === q.id)?.answer || "(No answer provided)";
        
        setProgress({ current: i + 1, total: qData.length });

        const prompt = `
          Evaluate the student's descriptive answer based on the reference answer and question.
          
          Evaluation Strictness: ${strictness}
          ${strictness === 'Flexible' ? 'BE FLEXIBLE: Allow for synonyms, rephrasing, and slight variations in wording as long as the core semantic meaning matches the reference answer.' : ''}
          ${strictness === 'Strict' ? 'BE STRICT: Expect precise terminology and specific details as mentioned in the reference answer.' : ''}
          ${strictness === 'Balanced' ? 'BE BALANCED: Allow for natural language variations but ensure all key points are covered.' : ''}

          Question: ${q.question}
          Reference Answer: ${q.referenceAnswer}
          Student Answer: ${studentAns}
          Maximum Marks: ${q.maxMarks}

          Provide the evaluation in JSON format with the following fields:
          - score: a number between 0 and ${q.maxMarks}
          - status: "Correct", "Partially Correct", or "Wrong"
          - feedback: a brief explanation of the score
        `;

        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                score: { type: Type.NUMBER },
                status: { type: Type.STRING, enum: ["Correct", "Partially Correct", "Wrong"] },
                feedback: { type: Type.STRING }
              },
              required: ["score", "status", "feedback"]
            }
          }
        });

        const resultData = JSON.parse(response.text || "{}");
        
        evaluationResults.push({
          questionId: q.id,
          questionText: q.question,
          studentAnswer: studentAns,
          referenceAnswer: q.referenceAnswer,
          score: resultData.score,
          maxMarks: q.maxMarks,
          status: resultData.status,
          feedback: resultData.feedback
        });
      }

      setResults(evaluationResults);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred during evaluation.");
    } finally {
      setIsEvaluating(false);
    }
  };

  const summary: Summary = results.reduce((acc, curr) => ({
    totalScore: acc.totalScore + curr.score,
    maxScore: acc.maxScore + curr.maxMarks,
    correctCount: acc.correctCount + (curr.status === 'Correct' ? 1 : 0),
    partialCount: acc.partialCount + (curr.status === 'Partially Correct' ? 1 : 0),
    wrongCount: acc.wrongCount + (curr.status === 'Wrong' ? 1 : 0),
  }), { totalScore: 0, maxScore: 0, correctCount: 0, partialCount: 0, wrongCount: 0 });

  // --- UI Components ---

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="mb-12 border-b border-[#141414] pb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl md:text-6xl font-serif italic tracking-tight leading-none mb-2">
              IntelliEval
            </h1>
            <p className="text-sm uppercase tracking-widest opacity-60 font-mono">
              AI-Powered Test Evaluation System
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono opacity-60">
            <Info size={14} />
            <span>v1.0.0 / Gemini 3 Flash</span>
          </div>
        </header>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Controls */}
          <div className="lg:col-span-4 space-y-6">
            <section className="bg-white border border-[#141414] p-6 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
              <h2 className="font-serif italic text-xl mb-4 border-b border-[#141414] pb-2">Upload Files</h2>
              
              <div className="space-y-4">
                {/* Teacher File */}
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-mono opacity-60">Teacher Reference File (.txt)</label>
                  <button 
                    onClick={() => teacherInputRef.current?.click()}
                    className={`w-full flex items-center justify-between p-3 border border-dashed border-[#141414] hover:bg-[#141414] hover:text-white transition-colors text-sm ${teacherFile ? 'bg-[#141414] text-white' : ''}`}
                  >
                    <span className="truncate">{teacherFile ? teacherFile.name : 'Select Teacher File'}</span>
                    <Upload size={16} />
                  </button>
                  <input 
                    type="file" 
                    ref={teacherInputRef} 
                    className="hidden" 
                    accept=".txt"
                    onChange={(e) => setTeacherFile(e.target.files?.[0] || null)}
                  />
                </div>

                {/* Student File */}
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-mono opacity-60">Student Answer File (.txt)</label>
                  <button 
                    onClick={() => studentInputRef.current?.click()}
                    className={`w-full flex items-center justify-between p-3 border border-dashed border-[#141414] hover:bg-[#141414] hover:text-white transition-colors text-sm ${studentFile ? 'bg-[#141414] text-white' : ''}`}
                  >
                    <span className="truncate">{studentFile ? studentFile.name : 'Select Student File'}</span>
                    <Upload size={16} />
                  </button>
                  <input 
                    type="file" 
                    ref={studentInputRef} 
                    className="hidden" 
                    accept=".txt"
                    onChange={(e) => setStudentFile(e.target.files?.[0] || null)}
                  />
                </div>

                {/* Strictness Selection */}
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-mono opacity-60">Evaluation Strictness (Fuzzy Matching)</label>
                  <div className="grid grid-cols-3 gap-1 border border-[#141414] p-1 bg-[#f0f0f0]">
                    {(['Strict', 'Balanced', 'Flexible'] as const).map((level) => (
                      <button
                        key={level}
                        onClick={() => setStrictness(level)}
                        className={`py-1 text-[10px] font-mono uppercase transition-colors ${
                          strictness === level 
                            ? 'bg-[#141414] text-white' 
                            : 'hover:bg-white'
                        }`}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  disabled={!teacherFile || !studentFile || isEvaluating}
                  onClick={evaluateAnswers}
                  className="w-full mt-4 bg-[#141414] text-white p-4 font-serif italic text-lg hover:bg-opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                >
                  {isEvaluating ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />
                      Evaluating...
                    </>
                  ) : (
                    <>
                      <ClipboardCheck size={20} />
                      Start Evaluation
                    </>
                  )}
                </button>
              </div>

              {/* Format Help */}
              <div className="mt-8 p-4 bg-[#f0f0f0] border border-[#141414] text-[11px] font-mono space-y-2">
                <p className="font-bold uppercase">Expected Format:</p>
                <div className="opacity-70">
                  <p>Teacher: Q1: Question text, A: Answer, M: 5</p>
                  <p>Student: A1: Student answer text</p>
                </div>
              </div>
            </section>

            {/* Error Message */}
            <AnimatePresence>
              {error && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="bg-red-50 border border-red-900 p-4 text-red-900 text-xs font-mono flex gap-3"
                >
                  <AlertCircle size={16} className="shrink-0" />
                  <p>{error}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Progress */}
            {isEvaluating && (
              <div className="space-y-2">
                <div className="flex justify-between text-[10px] font-mono uppercase">
                  <span>Progress</span>
                  <span>{progress.current} / {progress.total}</span>
                </div>
                <div className="h-1 bg-white border border-[#141414]">
                  <motion.div 
                    className="h-full bg-[#141414]"
                    initial={{ width: 0 }}
                    animate={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-8 space-y-8">
            
            {/* Summary Cards */}
            {results.length > 0 && (
              <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white border border-[#141414] p-4 shadow-[2px_2px_0px_0px_rgba(20,20,20,1)]">
                  <p className="text-[10px] uppercase font-mono opacity-60 mb-1">Total Score</p>
                  <p className="text-3xl font-serif italic">{summary.totalScore.toFixed(1)}<span className="text-sm opacity-40 not-italic">/{summary.maxScore}</span></p>
                </div>
                <div className="bg-white border border-[#141414] p-4 shadow-[2px_2px_0px_0px_rgba(20,20,20,1)]">
                  <p className="text-[10px] uppercase font-mono opacity-60 mb-1">Correct</p>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-green-600" />
                    <p className="text-3xl font-serif italic">{summary.correctCount}</p>
                  </div>
                </div>
                <div className="bg-white border border-[#141414] p-4 shadow-[2px_2px_0px_0px_rgba(20,20,20,1)]">
                  <p className="text-[10px] uppercase font-mono opacity-60 mb-1">Partial</p>
                  <div className="flex items-center gap-2">
                    <AlertCircle size={16} className="text-amber-600" />
                    <p className="text-3xl font-serif italic">{summary.partialCount}</p>
                  </div>
                </div>
                <div className="bg-white border border-[#141414] p-4 shadow-[2px_2px_0px_0px_rgba(20,20,20,1)]">
                  <p className="text-[10px] uppercase font-mono opacity-60 mb-1">Wrong</p>
                  <div className="flex items-center gap-2">
                    <XCircle size={16} className="text-red-600" />
                    <p className="text-3xl font-serif italic">{summary.wrongCount}</p>
                  </div>
                </div>
              </section>
            )}

            {/* Detailed Results Table */}
            <section className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
              <div className="p-4 border-b border-[#141414] flex items-center justify-between bg-[#f9f9f9]">
                <h2 className="font-serif italic text-xl flex items-center gap-2">
                  <BarChart3 size={20} />
                  Evaluation Details
                </h2>
                {results.length > 0 && (
                  <span className="text-[10px] font-mono uppercase bg-[#141414] text-white px-2 py-1">
                    {results.length} Questions Evaluated
                  </span>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#141414] text-[11px] font-mono uppercase opacity-60">
                      <th className="p-4 font-normal">ID</th>
                      <th className="p-4 font-normal">Question & Answer</th>
                      <th className="p-4 font-normal">Status</th>
                      <th className="p-4 font-normal">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-12 text-center opacity-40 italic font-serif">
                          {isEvaluating ? 'Evaluating student performance...' : 'Upload files and start evaluation to see results.'}
                        </td>
                      </tr>
                    ) : (
                      results.map((res, idx) => (
                        <tr key={idx} className="border-b border-[#141414] hover:bg-[#f5f5f5] transition-colors group">
                          <td className="p-4 align-top font-mono text-xs">{res.questionId}</td>
                          <td className="p-4 align-top space-y-3">
                            <div>
                              <p className="text-xs font-bold mb-1 uppercase tracking-tighter opacity-40">Question</p>
                              <p className="text-sm font-medium">{res.questionText}</p>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="p-3 bg-green-50 border border-green-100 rounded-sm">
                                <p className="text-[9px] font-mono uppercase text-green-800 mb-1">Reference</p>
                                <p className="text-xs text-green-900">{res.referenceAnswer}</p>
                              </div>
                              <div className="p-3 bg-blue-50 border border-blue-100 rounded-sm">
                                <p className="text-[9px] font-mono uppercase text-blue-800 mb-1">Student</p>
                                <p className="text-xs text-blue-900">{res.studentAnswer}</p>
                              </div>
                            </div>
                            <div className="pt-2 border-t border-dashed border-gray-200">
                              <p className="text-[9px] font-mono uppercase opacity-40 mb-1">AI Feedback</p>
                              <p className="text-xs italic opacity-80">{res.feedback}</p>
                            </div>
                          </td>
                          <td className="p-4 align-top">
                            <span className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase rounded-full ${
                              res.status === 'Correct' ? 'bg-green-100 text-green-800' :
                              res.status === 'Partially Correct' ? 'bg-amber-100 text-amber-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {res.status === 'Correct' && <CheckCircle2 size={10} />}
                              {res.status === 'Partially Correct' && <AlertCircle size={10} />}
                              {res.status === 'Wrong' && <XCircle size={10} />}
                              {res.status}
                            </span>
                          </td>
                          <td className="p-4 align-top">
                            <div className="font-serif text-lg italic">
                              {res.score}<span className="text-[10px] opacity-40 not-italic">/{res.maxMarks}</span>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

          </div>
        </div>

        {/* Footer */}
        <footer className="mt-20 pt-8 border-t border-[#141414] flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] font-mono uppercase opacity-40">
          <p>© 2026 IntelliEval Systems</p>
          <div className="flex gap-6">
            <a href="#" className="hover:underline">Documentation</a>
            <a href="#" className="hover:underline">Privacy Policy</a>
            <a href="#" className="hover:underline">Support</a>
          </div>
        </footer>
      </div>
    </div>
  );
}
