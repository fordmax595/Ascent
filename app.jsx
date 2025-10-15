// This application provides a Daily Training Log structured around the RP Strength Hypertrophy methodology.
// Features include a multi-tab navigation (Home, Training, Progress, Library, Nutrition), a bold dark/red aesthetic,
// dynamic "B-Shift" scheduling, KPI tracking via Firestore, a rest timer, and Gemini TTS/Text-powered AI coaching.
// This version includes CNS Readiness, HRV input, and Cardio/Recovery logging, and a Recovery Trend Chart.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, setDoc, collection, query, onSnapshot, getDocs } from 'firebase/firestore';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';

// --- GEMINI API CONFIGURATION ---
const API_KEY = ""; // Key is provided by the Canvas environment at runtime
const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const TEXT_MODEL = "gemini-2.5-flash-preview-05-20"; 
const API_URL_TTS = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${API_KEY}`;
const API_URL_TEXT = `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${API_KEY}`;


// --- CONFIGURATION AND INITIALIZATION ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : '';
const USER_WEIGHT = 185; // Pounds
const LIFT_TIME = "6:00 AM"; // User's defined lift time

// 1. App Data Structure (The 4-day Metabolic Hypertrophy Split)
const WORKOUT_SCHEDULE = {
    1: { name: 'Legs 1 (Pump Focus)', exercises: [
        { id: 101, name: 'Hack Squat or Leg Press', sets: 3, repRange: '10-12', rest: 90, technique: 'Density: Minimize lockout.', muscle: 'Quads/Glutes' },
        { id: 102, name: 'Romanian Deadlift (RDL)', sets: 3, repRange: '8-10', rest: 90, technique: 'Maintain mechanical tension (slow eccentric).', muscle: 'Hamstrings/Glutes' },
        { id: 103, name: 'Seated Leg Curl', sets: 3, repRange: '12-15', rest: 60, technique: 'Drop Set on final set.', muscle: 'Hamstrings' },
        { id: 104, name: 'Standing or Seated Calf Raises', sets: 3, repRange: '15-20', rest: 45, technique: 'Maximize peak contraction and burn.', muscle: 'Calves' },
    ]},
    2: { name: 'Push (Volume/Pump)', exercises: [
        { id: 201, name: 'Machine Chest Press or Pec Deck', sets: 3, repRange: '12-15', rest: 75, technique: 'Myo-Rep Set on the final set.', muscle: 'Chest' },
        { id: 202, name: 'Machine Shoulder Press', sets: 3, repRange: '10-12', rest: 75, technique: 'Use machine for constant tension.', muscle: 'Shoulders' },
        { id: 203, name: 'Dumbbell or Machine Flyes', sets: 3, repRange: '15-20', rest: 45, technique: 'Drop Set on the final set.', muscle: 'Chest' },
        { id: 204, name: 'Cable Triceps Pushdown', sets: 3, repRange: '15-20', rest: 45, technique: '3s eccentric, short rest for occlusion.', muscle: 'Triceps' },
    ]},
    4: { name: 'Pull (Max Pump/Density)', exercises: [
        { id: 401, name: 'Wide Grip Lat Pulldown', sets: 3, repRange: '12-15', rest: 45, technique: 'Superset with Seated Cable Row.', muscle: 'Back/Lats' },
        { id: 402, name: 'Seated Cable Row', sets: 3, repRange: '12-15', rest: 45, technique: 'Superset with Lat Pulldown.', muscle: 'Back/Thickness' },
        { id: 403, name: 'Cable Bicep Curl', sets: 3, repRange: '15-20', rest: 45, technique: 'Drop Set on the final set.', muscle: 'Biceps' },
        { id: 404, name: 'Face Pull', sets: 2, repRange: '20-25', rest: 45, technique: 'High reps for localized pump.', muscle: 'Rear Delts' },
    ]},
    5: { name: 'Legs 2 (Max Metabolic Stress)', exercises: [
        { id: 501, name: 'Leg Extension', sets: 4, repRange: '15-20', rest: 45, technique: 'Pure metabolic overload. Drop Set on final set.', muscle: 'Quads' },
        { id: 502, name: 'Seated Leg Curl', sets: 4, repRange: '15-20', rest: 45, technique: 'Max density. Drop Set on final set.', muscle: 'Hamstrings' },
        { id: 503, name: 'Walking Lunges (or DB Reverse Lunges)', sets: 3, repRange: '12 steps/leg', rest: 75, technique: 'Higher volume and density.', muscle: 'Quads/Glutes' },
        { id: 504, name: 'Standing or Seated Calf Raises', sets: 3, repRange: '15-20', rest: 45, technique: 'Maximize peak contraction and burn.', muscle: 'Calves' },
    ]},
};

// --- UTILITY FUNCTIONS ---
const formatDate = (date) => date.toISOString().split('T')[0];
const today = new Date();
const currentDayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

const getWorkoutForDate = (currentDate, allLogs) => {
    const sequence = [1, 2, 4, 5]; // Mon (1), Tue (2), Thu (4), Fri (5)
    
    // Check if the current date is a scheduled rest day (Sun: 0, Wed: 3, Sat: 6)
    const currentDayKey = currentDate.getDay();
    if (currentDayKey === 0 || currentDayKey === 3 || currentDayKey === 6) return null; 

    // Find the key of the next workout in the sequence based on the last completed log
    let nextWorkoutKey = 1; // Default to Legs 1 (Monday)

    // Find the key of the last COMPLETED workout
    const completedLogs = Object.keys(allLogs)
        .filter(date => allLogs[date].isComplete)
        .sort((a, b) => new Date(b) - new Date(a)); 

    if (completedLogs.length > 0) {
        const lastCompletedLog = allLogs[completedLogs[0]];
        const lastCompletedKey = sequence.find(k => WORKOUT_SCHEDULE[k]?.name === lastCompletedLog.name);
        
        if (lastCompletedKey !== undefined) {
            const lastIndex = sequence.indexOf(lastCompletedKey);
            const nextIndex = (lastIndex + 1) % sequence.length;
            nextWorkoutKey = sequence[nextIndex];
        }
    }
    
    return WORKOUT_SCHEDULE[nextWorkoutKey];
};


// Helper function for muscle group icons (Mock)
const getMuscleGroup = (name) => {
    if (name.includes('Squat') || name.includes('Leg Press') || name.includes('Extension')) return 'Quads';
    if (name.includes('RDL') || name.includes('Curl')) return 'Hamstrings';
    if (name.includes('Chest') || name.includes('Flyes') || name.includes('Pec')) return 'Chest';
    if (name.includes('Shoulder Press')) return 'Shoulders';
    if (name.includes('Pulldown') || name.includes('Row')) return 'Back';
    if (name.includes('Bicep')) return 'Biceps';
    if (name.includes('Triceps')) return 'Triceps';
    return 'Other';
};

// --- AUDIO UTILITIES FOR TTS API ---
const base64ToArrayBuffer = (base64) => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
};

const pcmToWav = (pcmData, sampleRate = 24000, numChannels = 1) => {
    const pcm16 = new Int16Array(pcmData);
    const bitsPerSample = 16;
    const blockAlign = numChannels * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcm16.byteLength;
    const fileSize = 36 + dataSize;
    
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);
    
    // RIFF header
    view.setUint32(0, 0x52494646, false); 
    view.setUint32(4, fileSize, true);
    view.setUint32(8, 0x57415645, false); 
    
    // fmt sub-chunk
    view.setUint32(12, 0x666d7420, false); 
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    
    // data sub-chunk
    view.setUint32(36, 0x64617461, false); 
    view.setUint32(40, dataSize, true);
    
    const wavBuffer = new Uint8Array(fileSize + 8);
    wavBuffer.set(new Uint8Array(buffer), 0);
    wavBuffer.set(new Uint8Array(pcm16.buffer), 44);
    
    return new Blob([wavBuffer], { type: 'audio/wav' });
};


// --- FIREBASE AND AUTH HOOKS ---
const useFirebase = () => {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);

    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig);
            const firestore = getFirestore(app);
            const authentication = getAuth(app);
            
            // For debug logging
            // setLogLevel('Debug');

            setDb(firestore);
            setAuth(authentication);

            const signIn = async () => {
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(authentication, initialAuthToken);
                    } else {
                        await signInAnonymously(authentication); 
                    }
                } catch (error) {
                    console.error("Firebase Sign-in Failed:", error);
                }
            };

            const unsubscribe = onAuthStateChanged(authentication, (user) => {
                if (user) {
                    setUserId(user.uid);
                } else {
                    setUserId(null); 
                }
                setIsAuthReady(true);
            });

            signIn();
            return () => unsubscribe();
        } catch (error) {
            console.error("Firebase initialization failed:", error);
            setIsAuthReady(true);
        }
    }, []);

    return { db, auth, userId, isAuthReady };
};

const useLogs = (db, userId, isAuthReady, logType = 'workout_logs') => {
    const [logs, setLogs] = useState({});

    useEffect(() => {
        if (!db || !userId || !isAuthReady) return;

        const logsCollectionPath = `artifacts/${appId}/users/${userId}/${logType}`;
        const logsRef = collection(db, logsCollectionPath);
        const q = query(logsRef);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const newLogs = {};
            snapshot.forEach(doc => {
                newLogs[doc.id] = { ...doc.data(), id: doc.id };
            });
            setLogs(newLogs);
        }, (error) => {
            console.error(`Error fetching ${logType}:`, error);
        });

        return () => unsubscribe();
    }, [db, userId, isAuthReady, logType]);

    const saveLog = useCallback(async (dateString, logData) => {
        if (!db || !userId) return;
        try {
            const docRef = doc(db, `artifacts/${appId}/users/${userId}/${logType}`, dateString);
            await setDoc(docRef, logData, { merge: true });
        } catch (error) {
            console.error(`Error saving ${logType}:`, error);
        }
    }, [db, userId, logType]);

    return { logs, saveLog };
};

// Hook for Recovery Data (Now separated)
const useRecoveryLogs = (db, userId, isAuthReady) => {
    const { logs, saveLog } = useLogs(db, userId, isAuthReady, 'recovery_logs');
    const [recoveryData, setRecoveryData] = useState({});

    useEffect(() => {
        // Transform the logs object into a chart-friendly array
        const chartData = Object.keys(logs).map(date => {
            const log = logs[date];
            return {
                name: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                Readiness: log.readiness || 5,
                Soreness: log.soreness || 3,
                Sleep: log.sleepHours || 7,
                date: date
            };
        }).sort((a, b) => new Date(a.date) - new Date(b.date));
        
        setRecoveryData(chartData);

    }, [logs]);

    return { recoveryLogs: logs, saveRecoveryData: saveLog, recoveryChartData: recoveryData };
};

// Hook for Workout Logs
const useWorkoutLogs = (db, userId, isAuthReady) => {
    return useLogs(db, userId, isAuthReady, 'workout_logs');
};


// --- KPI CALCULATIONS ---
const useKPIs = (logs) => {
    const [kpis, setKpis] = useState({
        totalVolume: 0,
        consistencyScore: 0,
        overloadRatio: 0,
        totalSetsCompleted: 0
    });

    const [volumeData, setVolumeData] = useState([]);

    useEffect(() => {
        if (Object.keys(logs).length === 0) {
            setKpis({ totalVolume: 0, consistencyScore: 0, overloadRatio: 0, totalSetsCompleted: 0 });
            setVolumeData([]);
            return;
        }

        let totalVolume = 0;
        let totalSetsPlanned = 0;
        let totalSetsCompleted = 0;
        let setsWithNewMaxVolume = 0;
        const maxVolumeByExercise = {}; 
        const weeklyVolume = {};

        const sortedDates = Object.keys(logs).sort((a, b) => new Date(a) - new Date(b));

        sortedDates.forEach(date => {
            const log = logs[date];
            const dateObj = new Date(date);
            // Get week number (simple approximation)
            const weekStart = new Date(dateObj.setDate(dateObj.getDate() - dateObj.getDay()));
            const weekKey = formatDate(weekStart);

            if (!weeklyVolume[weekKey]) {
                weeklyVolume[weekKey] = { volume: 0, date: weekKey };
            }

            if (log.exercises) {
                log.exercises.forEach(exercise => {
                    // Calculate sets planned based on the structure (check if workout is defined in schedule)
                    const plannedWorkout = Object.values(WORKOUT_SCHEDULE).find(w => w.name === log.name);
                    const plannedSets = plannedWorkout ? plannedWorkout.exercises.find(e => e.id === exercise.id)?.sets || 0 : 0;
                    totalSetsPlanned += plannedSets;

                    if (exercise.setsData) {
                        exercise.setsData.forEach(set => {
                            if (set.isDone && set.weight > 0 && set.reps > 0) {
                                const volume = set.weight * set.reps;
                                totalVolume += volume;
                                weeklyVolume[weekKey].volume += volume;
                                totalSetsCompleted++;
                                
                                // Check for Progressive Overload (New Max Volume)
                                const exerciseId = exercise.id;
                                if (volume > (maxVolumeByExercise[exerciseId] || 0)) {
                                    maxVolumeByExercise[exerciseId] = volume; 
                                    setsWithNewMaxVolume++;
                                }
                            }
                        });
                    }
                });
            }
        });
        
        // Safety check for division by zero on consistency
        // Note: For a true consistency score based on PLANNED sets, we should only sum totalSetsPlanned
        // for days that were lift days. Since the log only saves on lift days, this is sufficient.
        const consistencyScore = totalSetsPlanned > 0 ? (totalSetsCompleted / totalSetsPlanned) * 100 : 0;
        // Overload ratio is based on completed sets
        const overloadRatio = totalSetsCompleted > 0 ? (setsWithNewMaxVolume / totalSetsCompleted) * 100 : 0;


        setKpis({
            totalVolume: Math.round(totalVolume), 
            consistencyScore: consistencyScore > 100 ? 100 : Math.round(consistencyScore), // Cap at 100%
            overloadRatio: Math.round(overloadRatio), 
            totalSetsCompleted: totalSetsCompleted
        });
        
        // Format for Chart
        const chartData = Object.keys(weeklyVolume).map(key => ({
            name: new Date(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            Volume: Math.round(weeklyVolume[key].volume),
            date: key 
        })).sort((a, b) => new Date(a.date) - new Date(b.date));

        setVolumeData(chartData);

    }, [logs]);

    return { kpis, volumeData };
};


// --- GEMINI CRITIQUE COMPONENT ---
const AICritiqueGenerator = ({ logData, logs }) => {
    const [loading, setLoading] = useState(false);
    const [audio, setAudio] = useState(null);
    const [error, setError] = useState(null);

    const generateCritique = useCallback(async () => {
        if (!logData || !logData.isComplete) {
            setError("Please complete all sets to receive an AI Critique.");
            return;
        }
        setLoading(true);
        setError(null);
        setAudio(null);

        // 1. Prepare Data for LLM Prompt
        const dataForPrompt = logData.exercises.map(ex => {
            const sets = ex.setsData.map(s => `${s.weight}lb/kg x ${s.reps} reps`).join(', ');
            return {
                exercise: ex.name,
                sets: ex.sets,
                repRange: ex.repRange,
                loggedPerformance: sets
            };
        });

        const userQuery = `Review the following completed workout for the ${logData.name} session. The goal is metabolic hypertrophy via double progression (increase reps within the range, then increase weight). The sets property indicates the number of sets completed. The repRange indicates the goal range (e.g., 12-15). The loggedPerformance shows the actual weight and reps achieved for each set. Provide a very short (1-2 sentence) motivational summary of the performance, and then provide ONE specific, actionable progression goal for the user's next session (e.g., "On the Hack Squat, aim for 11 reps on Set 3," or "Increase the weight by 2.5kg/5lb on the Leg Press next time."). The critique must be concise and use a firm, motivational tone. Data: ${JSON.stringify(dataForPrompt)}`;

        const systemPrompt = "Act as a highly specialized hypertrophy coach and training partner for a highly busy athlete. Your response must be extremely brief, actionable, and focus entirely on double progression for the next workout. Speak in a firm, direct tone.";

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            config: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: "Kore" } 
                    }
                }
            },
        };

        try {
            const response = await fetch(API_URL_TTS, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`TTS API request failed with status: ${response.status}`);
            }

            const result = await response.json();
            const part = result.candidates?.[0]?.content?.parts?.[0];
            const audioData = part?.inlineData?.data;
            
            if (audioData) {
                const pcmBuffer = base64ToArrayBuffer(audioData);
                const sampleRateMatch = part.inlineData.mimeType.match(/rate=(\d+)/);
                const sampleRate = sampleRateMatch ? parseInt(sampleRateMatch[1], 10) : 24000;

                const wavBlob = pcmToWav(pcmBuffer, sampleRate);
                const audioUrl = URL.createObjectURL(wavBlob);
                setAudio(audioUrl);
                
                new Audio(audioUrl).play().catch(e => console.error("Audio playback failed (usually related to browser restrictions):", e));

            } else {
                const fallbackText = result.candidates?.[0]?.content?.parts?.[0]?.text || "Analysis complete, but failed to generate audio.";
                setError(`Audio generation failed. Text: ${fallbackText.substring(0, 100)}...`);
            }

        } catch (err) {
            console.error("Gemini API Error:", err);
            setError(`Failed to connect to the AI Coach. Please check console for details.`);
        } finally {
            setLoading(false);
        }
    }, [logData]);

    return (
        <div className="mt-4 p-4 rounded-xl shadow-lg bg-red-900 bg-opacity-30 border border-red-800">
            <button
                onClick={generateCritique}
                disabled={loading || !logData || !logData.isComplete}
                className={`w-full py-3 px-4 rounded-xl font-bold text-white transition-all duration-300 transform active:scale-95 flex items-center justify-center space-x-2 ${
                    loading ? 'bg-red-400 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'
                }`}
            >
                {loading && (
                    <svg className="animate-spin h-5 w-5 mr-3 text-white" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeDasharray="80" strokeDashoffset="40"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                )}
                <span className="text-lg">
                    ✨ {loading ? 'Analyzing Performance...' : 'Get AI Coach Critique (Audio)'}
                </span>
            </button>
            {error && <p className="text-red-400 text-sm mt-3 text-center">{error}</p>}
            {audio && (
                <p className="text-green-400 text-sm mt-3 text-center">
                    Critique generated! Playing audio now... Check console if audio doesn't play.
                </p>
            )}
        </div>
    );
};


// --- TIMER COMPONENT (No changes needed) ---
const RestTimer = ({ initialTime, isRunning, onToggle, isTicking }) => {
    const [time, setTime] = useState(initialTime);

    useEffect(() => {
        setTime(initialTime);
    }, [initialTime]);

    useEffect(() => {
        let timer = null;
        if (isRunning && time > 0) {
            timer = setInterval(() => {
                setTime(prevTime => prevTime - 1);
            }, 1000);
        } else if (time === 0 && isRunning) {
            const playSound = () => { console.log('Timer finished sound!'); };
            playSound();
            onToggle(false);
            setTime(initialTime);
        }
        return () => clearInterval(timer);
    }, [isRunning, time, initialTime, onToggle]);

    const minutes = Math.floor(time / 60);
    const seconds = time % 60;

    const buttonClass = isRunning 
        ? "bg-red-800 hover:bg-red-900 active:bg-red-900 text-white shadow-lg border border-red-600" 
        : "bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-white shadow-lg border border-gray-600";

    return (
        <div className={`p-4 rounded-xl ${isTicking ? 'bg-opacity-90 shadow-2xl bg-gray-900' : 'bg-opacity-60'} transition-all duration-300`}>
            <div className="text-4xl font-extrabold mb-3 text-center text-red-400 transition-colors duration-300">
                {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
            </div>
            <button
                onClick={() => onToggle(!isRunning)}
                className={`w-full py-2 px-4 font-bold rounded-lg transition-all duration-300 transform active:scale-95 ${buttonClass}`}
            >
                {isRunning ? 'STOP / RESET' : `START ${initialTime}s REST`}
            </button>
        </div>
    );
};


// --- CORE RENDER COMPONENTS ---

const ProgramBlockOverview = ({ cardColor }) => (
    <div className="space-y-6">
        <h4 className="text-2xl font-bold text-red-400 border-b border-gray-700 pb-2">6-Week Metabolic Phase Overview</h4>
        <p className="text-sm text-gray-400 italic">This plan maximizes Hypertrophy via Metabolic Stress (Pump Focus).</p>
        
        {Object.entries(WORKOUT_SCHEDULE).map(([key, workout]) => {
            const dayMap = { 1: 'MON (LIFT)', 2: 'TUE (LIFT)', 4: 'THU (LIFT)', 5: 'FRI (LIFT)' };
            const dayKey = parseInt(key);

            return (
                <div key={key} className={`p-4 rounded-xl ${cardColor} border border-gray-700 shadow-md`}>
                    <h5 className="text-lg font-extrabold text-red-400">{dayMap[dayKey] || `Day ${dayKey}`}</h5>
                    <p className="text-sm text-white font-semibold mt-1">{workout.name}</p>
                    <ul className="text-xs text-gray-400 list-disc ml-4 mt-2 space-y-1">
                        {workout.exercises.slice(0, 3).map((ex, i) => (
                            <li key={i}>{ex.name} ({ex.repRange}) - {ex.rest}s Rest</li>
                        ))}
                        <li>...and 1 more exercise.</li>
                    </ul>
                </div>
            );
        })}
        
        <div className={`p-4 rounded-xl ${cardColor} border border-gray-700 shadow-md`}>
            <h5 className="text-lg font-extrabold text-yellow-500">Deload (Week 5)</h5>
            <p className="text-sm text-gray-400 mt-1">Reduce Volume by 50% | Target RPE 5-6 (Mandatory for recovery).</p>
        </div>
    </div>
);


const TrainingProgram = ({ localLog, prevLogData, currentDate, navigateDate, handleSetChange, inputColor, cardColor, buttonPrimary, logs, userId, timerSettings, setTimerSettings, isAuthReady, recoveryData, saveRecoveryData }) => {
    
    const dateString = formatDate(currentDate);
    const logsForDate = logs[dateString] || null;
    const isRestDay = !localLog;
    const recoveryDayKey = currentDate.getDay(); // 0=Sun, 3=Wed, 6=Sat

    const getPreviousSetData = (exerciseId, setIndex) => {
        if (!prevLogData) return null;
        const prevEx = prevLogData.exercises.find(ex => ex.id === exerciseId);
        if (!prevEx || !prevEx.setsData || !prevEx.setsData[setIndex]) return null;
        return prevEx.setsData[setIndex];
    };

    // Smart Prediction Feature
    const getPrediction = (exerciseId, setIndex) => {
        const prevSet = getPreviousSetData(exerciseId, setIndex);
        if (!prevSet || prevSet.weight === 0) return null;

        const exercise = WORKOUT_SCHEDULE[localLog.id]?.exercises.find(ex => ex.id === exerciseId);
        if (!exercise) return null;

        const [minReps, maxReps] = exercise.repRange.split('-').map(Number);
        const lastReps = prevSet.reps;
        const lastWeight = prevSet.weight;
        
        if (lastReps < minReps) {
            return `Target: ${minReps} reps at ${lastWeight} lb/kg`; // Needs to hit min reps
        } else if (lastReps < maxReps) {
            return `Target: ${lastReps + 1} reps at ${lastWeight} lb/kg`; // Double progression: increment reps
        } else {
            // Hit max reps, suggest increasing weight and resetting reps
            // Round up to nearest 2.5 unit step (common plate jump)
            const newWeight = Math.ceil((lastWeight * 1.025) / 2.5) * 2.5; 
            return `Target: ${minReps} reps at ${newWeight} lb/kg (+Weight)`;
        }
    };
    
    const handleRecoveryChange = (field, value) => {
        saveRecoveryData(dateString, { ...recoveryData, [field]: Number(value) || value });
    };

    const renderCardioRecoveryLog = () => {
        const schedule = {
            0: 'Absolute Passive Rest', // Sunday
            3: 'Running 1: HIIT (Max Intensity/Min Duration)', // Wednesday
            6: 'Running 3: Easy Aerobic Run (30-45 min) + BJJ 2: Intensive Rolling', // Saturday
        };
        const sessionName = schedule[recoveryDayKey];
        if (!sessionName) return null;

        return (
            <div className={`mt-8 p-5 rounded-xl shadow-lg ${cardColor} border border-gray-700`}>
                <h4 className="text-xl font-bold mb-3 text-yellow-500">
                    {currentDate.toLocaleDateString('en-US', { weekday: 'long' })} Recovery Session
                </h4>
                <p className="text-sm text-gray-400 mb-4">{sessionName}</p>

                <div className="space-y-3">
                    <h5 className="text-lg font-semibold text-red-400">Cardio Log</h5>
                    <label className="block text-sm font-medium text-gray-400">Duration (Minutes)</label>
                    <input
                        type="number"
                        placeholder="e.g., 20"
                        value={recoveryData.cardioDuration || ''}
                        onChange={(e) => handleRecoveryChange('cardioDuration', e.target.value)}
                        className="w-full p-2 rounded-lg bg-gray-700 text-white border border-gray-600"
                    />
                    <label className="block text-sm font-medium text-gray-400">Type/Notes (e.g., LISS/HIIT/BJJ)</label>
                    <input
                        type="text"
                        placeholder="e.g., 30 mins Zone 2 LISS"
                        value={recoveryData.cardioNotes || ''}
                        onChange={(e) => handleRecoveryChange('cardioNotes', e.target.value)}
                        className="w-full p-2 rounded-lg bg-gray-700 text-white border border-gray-600"
                    />
                </div>
            </div>
        );
    };


    const renderWorkoutLog = () => {
        if (isRestDay || !localLog) {
            return (
                <div className="space-y-6">
                    <div className={`p-6 rounded-xl shadow-lg ${cardColor} border border-gray-700`}>
                        <p className="text-center text-xl font-semibold text-red-400">
                            {currentDate.toLocaleDateString('en-US', { weekday: 'long' })} is a Planned Rest Day!
                        </p>
                        <p className="text-center mt-2 text-gray-500">
                            Check the Cardio/Recovery log below for today's required session.
                        </p>
                    </div>
                    {renderCardioRecoveryLog()}
                </div>
            );
        }

        return (
            <div className="space-y-6">
                <div className={`p-5 rounded-xl shadow-xl ${cardColor} border border-gray-700`}>
                    <h3 className="text-2xl font-extrabold text-red-400 mb-2">
                        {localLog.name}
                    </h3>
                    <p className={`text-sm font-medium ${localLog.isComplete ? 'text-green-500' : 'text-yellow-500'}`}>
                        Status: {localLog.isComplete ? 'Completed' : 'In Progress'}
                    </p>
                </div>
                
                <AIVolumeAdjuster localLog={localLog} recoveryData={recoveryData} cardColor={cardColor} />

                {localLog.exercises.map(exercise => (
                    <div key={exercise.id} className={`p-5 rounded-xl shadow-lg ${cardColor} border border-gray-700`}>
                        <h4 className="text-xl font-bold mb-1">{exercise.name}</h4>
                        <p className="text-sm text-gray-500 mb-3 italic">
                            {exercise.sets} sets | Reps: {exercise.repRange} | Rest: {exercise.rest}s | Technique: {exercise.technique}
                        </p>
                        
                        {exercise.setsData.map((set, setIndex) => {
                            const prediction = getPrediction(exercise.id, setIndex);
                            return (
                                <div key={setIndex} className="flex flex-col sm:flex-row items-start sm:items-center space-y-2 sm:space-y-0 sm:space-x-3 mb-2 p-3 rounded-lg hover:bg-gray-700 transition-colors duration-200 border-b border-gray-700 last:border-b-0">
                                    <span className="font-semibold w-full sm:w-16 flex-shrink-0">Set {set.set}:</span>
                                    
                                    <div className="flex-1 w-full flex space-x-2">
                                        {/* Weight Input */}
                                        <div className="w-1/2">
                                            <input
                                                type="number"
                                                step="2.5"
                                                placeholder="Weight"
                                                value={set.weight || ''}
                                                onChange={(e) => handleSetChange(exercise.id, setIndex, 'weight', e.target.value)}
                                                className={`w-full p-2 rounded-lg text-sm transition-colors ${inputColor}`}
                                            />
                                            {prediction && <p className="text-xs text-red-400 mt-1">Goal: {prediction.split('at')[1]}</p>}
                                        </div>
                                        {/* Reps Input */}
                                        <div className="w-1/2">
                                            <input
                                                type="number"
                                                placeholder="Reps"
                                                value={set.reps || ''}
                                                onChange={(e) => handleSetChange(exercise.id, setIndex, 'reps', e.target.value)}
                                                className={`w-full p-2 rounded-lg text-sm transition-colors ${inputColor}`}
                                            />
                                            {prediction && <p className="text-xs text-red-400 mt-1">{prediction.split('at')[0].replace('Target:', '')}</p>}
                                        </div>
                                    </div>
                                    
                                    {/* Completion Checkbox */}
                                    <div className="flex items-center justify-end w-full sm:w-12 flex-shrink-0">
                                        <input
                                            type="checkbox"
                                            checked={set.isDone}
                                            onChange={(e) => handleSetChange(exercise.id, setIndex, 'isDone', e.target.checked)}
                                            className="h-6 w-6 text-red-600 rounded border-gray-300 focus:ring-red-500"
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ))}
                
                <AICritiqueGenerator logData={localLog} logs={logs} />
            </div>
        );
    };

    return (
        <div className="space-y-8">
            {/* Date Navigation and Timer */}
            <div className="flex flex-col sm:flex-row justify-between items-center mb-8 space-y-4 sm:space-y-0">
                {/* Date Picker */}
                <div className="flex items-center space-x-3 w-full sm:w-auto justify-center sm:justify-start">
                    <button
                        onClick={() => navigateDate(-1)}
                        className={`p-2 rounded-full ${buttonPrimary} transition-transform transform active:scale-95`}
                        title="Previous Day"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <span className="text-xl font-bold w-32 text-center">
                        {currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' })}
                    </span>
                    <button
                        onClick={() => navigateDate(1)}
                        className={`p-2 rounded-full ${buttonPrimary} transition-transform transform active:scale-95`}
                        title="Next Day"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </button>
                </div>

                {/* Rest Timer Buttons */}
                <div className="flex space-x-4 w-full sm:w-auto justify-center sm:justify-end">
                    <button 
                        onClick={() => setTimerSettings({ isRunning: true, initialTime: 90 })}
                        className={`py-2 px-4 rounded-lg font-semibold transition-colors duration-300 bg-red-600 hover:bg-red-700 text-white transform active:scale-95 border border-red-400`}
                    >
                        90s Rest
                    </button>
                    <button 
                        onClick={() => setTimerSettings({ isRunning: true, initialTime: 120 })}
                        className={`py-2 px-4 rounded-lg font-semibold transition-colors duration-300 bg-red-600 hover:bg-red-700 text-white transform active:scale-95 border border-red-400`}
                    >
                        120s Rest
                    </button>
                </div>
            </div>

            {/* Timer Display */}
            {timerSettings.isRunning && (
                <div className="mb-6">
                    <RestTimer 
                        initialTime={timerSettings.initialTime} 
                        isRunning={timerSettings.isRunning} 
                        onToggle={(newState) => setTimerSettings(prev => ({ ...prev, isRunning: newState }))}
                        isTicking={true}
                    />
                </div>
            )}
            
            <h3 className="text-3xl font-extrabold text-red-400 mb-6 border-b border-gray-700 pb-3">Daily Workout Log</h3>
            
            {/* Workout Rendering */}
            {renderWorkoutLog()}
            
            {/* Program Overview Added */}
            <div className="mt-10">
                <ProgramBlockOverview cardColor={cardColor} />
            </div>
        </div>
    );
};

// --- AI VOLUME ADJUSTER (MRV Prediction) ---

const AIVolumeAdjuster = ({ localLog, recoveryData, cardColor }) => {
    const [advice, setAdvice] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const generateAdjustment = useCallback(async () => {
        setLoading(true);
        setAdvice('');
        setError(null);

        const workoutName = localLog.name;
        const sleepHours = recoveryData.sleepHours || 7;
        const soreness = recoveryData.soreness || 5;
        const readiness = recoveryData.readiness || 5;
        const hrv = recoveryData.hrv || 'N/A';

        const prompt = `I am a hypertrophy athlete performing the workout: "${workoutName}". My recovery metrics are: Sleep=${sleepHours} hours, Soreness=${soreness}/10, Readiness=${readiness}/10, HRV=${hrv}. Based on this data, provide ONE concise, actionable recommendation for today's volume (e.g., "Reduce all sets by 1 to manage CNS fatigue," or "Proceed as planned for Max Volume"). Your response must be 1-2 sentences.`;

        const systemPrompt = "Act as a specialist in Maximum Recoverable Volume (MRV). Use the recovery metrics to determine if the athlete should push volume (if metrics are good: Sleep>7, Soreness<5, Readiness>7) or reduce volume (if metrics are poor).";

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
        };

        try {
            const response = await fetch(API_URL_TEXT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text || "Failed to retrieve volume adjustment advice.";
            setAdvice(generatedText);

        } catch (err) {
            console.error("Gemini Volume Adjuster API Error:", err);
            setError("Failed to generate volume advice.");
        } finally {
            setLoading(false);
        }
    }, [localLog, recoveryData]);

    return (
        <div className={`p-5 rounded-xl shadow-xl ${cardColor} border-t-4 border-yellow-500 border border-gray-700 mt-6`}>
            <h4 className="text-xl font-bold mb-3 text-yellow-500 flex items-center">
                <span className="mr-2">🧠</span> AI Volume Adjuster
            </h4>
            <button
                onClick={generateAdjustment}
                disabled={loading}
                className={`w-full py-2 px-4 rounded-lg font-bold text-white transition-all duration-300 ${loading ? 'bg-gray-500 cursor-not-allowed' : 'bg-yellow-600 hover:bg-yellow-700'}`}
            >
                {loading ? 'Calculating MRV...' : 'Calculate Daily Volume Adjustment'}
            </button>
            {advice && (
                <div className="mt-4 p-3 bg-gray-900 rounded-lg border border-yellow-700">
                    <p className="text-sm italic text-white">{advice}</p>
                </div>
            )}
            {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
        </div>
    );
};

// --- AI PROGRAM PLANNER ---

const AILoadoutPlanner = ({ kpis, cardColor }) => {
    const [advice, setAdvice] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const generateAdvice = useCallback(async () => {
        setLoading(true);
        setAdvice('');
        setError(null);

        const prompt = `Based on the following 6-week hypertrophy training key performance indicators (KPIs), provide a single, concise recommendation for the next training phase: Should the athlete deload, stick with the current block, or progress to a new block? Focus on metabolic stress (pump) as the goal.
        KPI Data:
        - Consistency Score (Sets Completed): ${kpis.consistencyScore}%
        - Progressive Overload Ratio (Sets hitting new max volume): ${kpis.overloadRatio}%
        - Total Volume Lifted (approx. lifetime): ${kpis.totalVolume.toLocaleString()}
        
        Recommendation should be 2-3 sentences max and address both consistency and overload. Start with: "Coach says: "`;

        const systemPrompt = "Act as a specialized hypertrophy periodization coach. Analyze the KPI data provided. If Consistency is below 70% or Overload is below 10%, recommend a deload or adherence focus. If both are high (above 80% and 15% respectively), recommend progression or a volume increase. Be concise and authoritative.";

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
        };

        try {
            const response = await fetch(API_URL_TEXT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text || "Failed to retrieve analysis.";
            setAdvice(generatedText);

        } catch (err) {
            console.error("Gemini Planner API Error:", err);
            setError("Failed to generate program advice.");
        } finally {
            setLoading(false);
        }
    }, [kpis]);

    return (
        <div className="space-y-6">
            <div className={`p-5 rounded-xl shadow-xl ${cardColor} border-t-4 border-red-500 border border-gray-700 mt-6`}>
                <h4 className="text-xl font-bold mb-3 text-red-400 flex items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0h6m-6 0v-5a2 2 0 012-2h2a2 2 0 012 2v5m-6 0h6" /></svg>
                    ✨ Next Phase Planner
                </h4>
                <button
                    onClick={generateAdvice}
                    disabled={loading}
                    className={`w-full py-2 px-4 rounded-lg font-bold text-white transition-all duration-300 ${loading ? 'bg-gray-500 cursor-not-allowed' : 'bg-pink-600 hover:bg-pink-700'}`}
                >
                    {loading ? 'Analyzing Data...' : 'Get Next Phase Recommendation'}
                </button>
                {advice && (
                    <div className="mt-4 p-3 bg-gray-900 rounded-lg border border-pink-700">
                        <p className="text-sm italic text-white">{advice}</p>
                    </div>
                )}
                {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
            </div>
        </div>
    );
};

// --- RECOVERY TREND CHART ---
const RecoveryTrendChart = ({ recoveryChartData, cardColor }) => (
    <div className={`p-5 rounded-xl shadow-xl ${cardColor} border border-gray-700`}>
        <h4 className="text-xl font-bold mb-2 text-yellow-500">Recovery Trend (Soreness vs. Readiness)</h4>
        <p className="text-sm text-gray-500 mb-3">Goal: Readiness (Red) must be higher than Soreness (Yellow).</p>
        <div style={{ width: '100%', height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={recoveryChartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid stroke="#374151" strokeDasharray="3 3" />
                    <XAxis dataKey="name" stroke="#9ca3af" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" stroke="#9ca3af" domain={[0, 10]} tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }} itemStyle={{ color: '#fca5a5' }}/>
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="Readiness" stroke="#ef4444" strokeWidth={2} name="Readiness (1-10)" />
                    <Line yAxisId="left" type="monotone" dataKey="Soreness" stroke="#f59e0b" strokeWidth={2} name="Soreness (1-10)" />
                </LineChart>
            </ResponsiveContainer>
        </div>
    </div>
);


const ProgressDashboard = ({ kpis, volumeData, recoveryChartData, cardColor, userId }) => {
    
    // Determine the current weekly volume trend for the home screen (last data point)
    const latestVolume = volumeData.length > 0 ? volumeData[volumeData.length - 1].Volume : 0;
    const previousVolume = volumeData.length > 1 ? volumeData[volumeData.length - 2].Volume : 0;
    const volumeChange = latestVolume - previousVolume;
    const volumeTrend = volumeChange > 0 ? `+${(volumeChange/1000).toFixed(1)}K` : `${(volumeChange/1000).toFixed(1)}K`;
    const trendColor = volumeChange > 0 ? 'text-green-400' : 'text-red-400';

    return (
        <div className="space-y-6">
            <h3 className="text-3xl font-extrabold text-red-400 mb-6 border-b border-gray-700 pb-3">Progress & Analytics</h3>
            
            {/* User ID and Consistency Report */}
            <div className={`p-5 rounded-xl shadow-xl ${cardColor} border border-gray-700`}>
                <h4 className="text-xl font-bold mb-2 text-red-400">Consistency Score</h4>
                <div className="flex justify-between items-center border-t border-gray-700 pt-3">
                    <p className="font-semibold">Sets Completion Rate</p>
                    <p className="text-3xl font-extrabold text-green-500">{kpis.consistencyScore}%</p>
                </div>
                <p className="text-xs text-gray-500 mt-1">Sets Completed vs. Sets Planned across all logs.</p>
                <p className="text-xs text-gray-500 mt-1">Your User ID: {userId}</p>
            </div>

            {/* KPI Card Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                
                {/* KPI 1: Total Volume Lifted */}
                <div className={`p-5 rounded-xl shadow-lg ${cardColor} border-t-4 border-red-500 border border-gray-700`}>
                    <p className="text-sm font-medium text-gray-500">Total Volume Lifted (kg/lb)</p>
                    <p className="text-3xl font-extrabold mt-1 text-red-400">{(kpis.totalVolume / 1000).toFixed(1)}K</p>
                    <p className="text-xs text-gray-500">Volume = Sum of (Weight x Reps)</p> 
                </div>

                {/* KPI 2: Progressive Overload Ratio */}
                <div className={`p-5 rounded-xl shadow-lg ${cardColor} border-t-4 border-pink-500 border border-gray-700`}>
                    <p className="text-sm font-medium text-gray-500">New Max Volume Ratio</p>
                    <p className="text-3xl font-extrabold mt-1 text-pink-500">{kpis.overloadRatio}%</p>
                    <p className="text-xs text-gray-500">Sets that surpassed previous max volume for that exercise.</p>
                </div>

                {/* KPI 3: Lifts Completed */}
                <div className={`p-5 rounded-xl shadow-lg ${cardColor} border-t-4 border-yellow-500 border border-gray-700`}>
                    <p className="text-sm font-medium text-gray-500">Total Sets Completed</p>
                    <p className="text-3xl font-extrabold mt-1 text-yellow-500">{kpis.totalSetsCompleted}</p>
                    <p className="text-xs text-gray-500">Measure of sustained effort (volume base).</p>
                </div>
            </div>

            {/* Recovery Trend Chart */}
            <RecoveryTrendChart recoveryChartData={recoveryChartData} cardColor={cardColor} />

            {/* Volume Trend Chart */}
            <div className={`p-5 rounded-xl shadow-xl ${cardColor} border border-gray-700`}>
                <h4 className="text-xl font-bold mb-2">Weekly Volume Trend</h4>
                <p className={`text-sm font-semibold mb-3 ${trendColor}`}>
                    Weekly Volume Change: {volumeTrend} (from last tracked week)
                </p>
                <div style={{ width: '100%', height: 250 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={volumeData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8}/>
                                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0.1}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid stroke="#374151" strokeDasharray="3 3" />
                            <XAxis dataKey="name" stroke="#9ca3af" tick={{ fontSize: 10 }} />
                            <YAxis stroke="#9ca3af" tick={{ fontSize: 10 }} domain={['dataMin', 'dataMax']} />
                            <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }} itemStyle={{ color: '#fca5a5' }}/>
                            <Area type="monotone" dataKey="Volume" stroke="#ef4444" fillOpacity={1} fill="url(#colorVolume)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Gemini Loadout Planner */}
            <AILoadoutPlanner kpis={kpis} cardColor={cardColor} />
        </div>
    );
};

const HomeDashboard = ({ localLog, currentDate, kpis, volumeData, cardColor, recoveryData, saveRecoveryData, userId }) => { 
    
    const latestVolume = volumeData.length > 0 ? volumeData[volumeData.length - 1].Volume : 0;
    const previousVolume = volumeData.length > 1 ? volumeData[volumeData.length - 2].Volume : 0;
    const volumeChange = latestVolume - previousVolume;
    const volumeTrend = volumeChange > 0 ? `+${(volumeChange/1000).toFixed(1)}k` : `${(volumeChange/1000).toFixed(1)}k`;
    const trendColor = volumeChange > 0 ? 'text-green-400' : 'text-red-400';

    const todayName = currentDate.toLocaleDateString('en-US', { weekday: 'long' });
    const isRestDay = !localLog;
    const workoutName = isRestDay ? "Recovery / Skill Work" : localLog.name;
    const workoutAccent = isRestDay ? "text-yellow-500" : "text-red-400";

    const handleRecoveryChange = (field, value) => {
        saveRecoveryData(formatDate(currentDate), { ...recoveryData, [field]: Number(value) || value });
    };

    return (
        <div className="space-y-6">
            <div className={`p-6 rounded-xl shadow-2xl ${cardColor} border-l-4 border-red-500`}>
                <p className="text-xl font-medium text-gray-400">Welcome Back, Athlete.</p>
                <h3 className={`text-3xl font-extrabold mt-1 ${workoutAccent}`}>{todayName}</h3>
                <p className="text-xs text-gray-500 mt-2">User ID: {userId}</p>
            </div>

            {/* Today's Workout Card (CTA) */}
            <div className={`p-6 rounded-xl shadow-xl ${cardColor} border border-gray-700`}>
                <p className="text-sm font-medium text-gray-500">Today's Session</p>
                <h4 className="text-2xl font-bold mt-1 mb-4 text-red-400">{workoutName}</h4>
                <a href="#training" onClick={() => document.getElementById('training-tab').click()} className={`w-full block text-center py-3 px-4 rounded-xl font-bold text-white transition-all duration-300 transform active:scale-95 bg-red-600 hover:bg-red-700`}>
                    {isRestDay ? 'Review Schedule' : 'Start Workout'}
                </a>
            </div>

            {/* Quick Metrics (Stat Tiles) */}
            <div className="grid grid-cols-2 gap-4">
                <div className={`p-4 rounded-xl shadow-lg ${cardColor} border border-gray-700`}>
                    <p className="text-sm font-medium text-gray-500">Weekly Volume</p>
                    <p className="text-2xl font-extrabold mt-1 text-red-400">
                        {(latestVolume/1000).toFixed(1)}K
                    </p>
                    <p className={`text-xs ${trendColor} font-semibold`}>
                        {volumeTrend} change
                    </p>
                </div>
                <div className={`p-4 rounded-xl shadow-lg ${cardColor} border border-gray-700`}>
                    <p className="text-sm font-medium text-gray-500">Consistency</p>
                    <p className="text-2xl font-extrabold mt-1 text-green-500">
                        {kpis.consistencyScore}%
                    </p>
                    <p className="text-xs text-gray-500 font-semibold">
                        {kpis.totalSetsCompleted} sets logged
                    </p>
                </div>
            </div>

            {/* Recovery Tracking */}
            <div className={`p-5 rounded-xl shadow-lg ${cardColor} border border-gray-700`}>
                <h4 className="text-xl font-bold mb-3 text-red-400">Recovery Metrics</h4>
                <div className="space-y-4">
                    
                    {/* Sleep Input */}
                    <div>
                        <label className="block text-sm font-medium text-gray-400">Sleep (Hours)</label>
                        <input
                            type="number"
                            step="0.1"
                            placeholder="7.5"
                            value={recoveryData.sleepHours || ''}
                            onChange={(e) => handleRecoveryChange('sleepHours', e.target.value)}
                            className="w-full p-2 rounded-lg bg-gray-700 text-white border border-gray-600"
                        />
                    </div>
                    
                    {/* HRV Input */}
                    <div>
                        <label className="block text-sm font-medium text-gray-400">HRV (ms - Morning Reading)</label>
                        <input
                            type="number"
                            placeholder="55-80"
                            value={recoveryData.hrv || ''}
                            onChange={(e) => handleRecoveryChange('hrv', e.target.value)}
                            className="w-full p-2 rounded-lg bg-gray-700 text-white border border-gray-600"
                        />
                    </div>

                    {/* Readiness Slider */}
                    <div>
                        <label className="block text-sm font-medium text-gray-400">CNS Readiness (1-10)</label>
                        <input
                            type="range"
                            min="1"
                            max="10"
                            value={recoveryData.readiness || 5}
                            onChange={(e) => handleRecoveryChange('readiness', e.target.value)}
                            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-lg accent-red-600"
                        />
                        <p className="text-sm text-center text-red-400 font-semibold">Score: {recoveryData.readiness || 5}</p>
                    </div>

                    {/* Soreness Slider */}
                    <div>
                        <label className="block text-sm font-medium text-gray-400">Soreness (1-10)</label>
                        <input
                            type="range"
                            min="1"
                            max="10"
                            value={recoveryData.soreness || 3}
                            onChange={(e) => handleRecoveryChange('soreness', e.target.value)}
                            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-lg accent-red-600"
                        />
                        <p className="text-sm text-center text-red-400 font-semibold">Level: {recoveryData.soreness || 3}</p>
                    </div>
                </div>
            </div>

            {/* BJJ Recovery Advisor */}
            <BJJRecoveryAdvisor 
                lastWorkout={localLog} 
                recoveryData={recoveryData} 
                cardColor={cardColor}
            />
            
        </div>
    );
};

// --- BJJ Recovery Advisor Component ---

const BJJRecoveryAdvisor = ({ lastWorkout, recoveryData, cardColor }) => {
    const [advice, setAdvice] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const generateAdvice = useCallback(async () => {
        if (!lastWorkout) {
            setError("Log a lift first to get personalized recovery advice!");
            return;
        }

        setLoading(true);
        setAdvice('');
        setError(null);
        
        const lastWorkoutName = lastWorkout.name;
        const sleepHours = recoveryData.sleepHours || 7;
        const soreness = recoveryData.soreness || 3;
        const readiness = recoveryData.readiness || 7;
        const hrv = recoveryData.hrv || 'N/A';

        // Check if today is a BJJ day (Mon/Sat)
        const todayDay = new Date().getDay();
        const isBJJDay = (todayDay === 1 || todayDay === 6); 

        if (!isBJJDay) {
            setAdvice("No BJJ today. Focus on active recovery from your last lift.");
            setLoading(false);
            return;
        }

        const prompt = `I am a BJJ athlete lifting weights 4x/week. I just completed the workout: "${lastWorkoutName}" (or lift was yesterday) and my BJJ session is tonight/later. My recovery metrics are: Sleep=${sleepHours} hours, Soreness=${soreness}/10, Readiness=${readiness}/10, HRV=${hrv}. Provide a specific, 3-point mobility/warm-up checklist for my BJJ session tonight to mitigate fatigue from the lift and protect the muscles used. Prioritize hip range of motion and shoulder stability.`;

        const systemPrompt = "Act as a specialist in strength and conditioning for combat sports. Your response must be highly actionable and delivered as three numbered points focusing on mobility and joint preparation. DO NOT include introductory or concluding text. Just the 3 numbered points.";

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
        };

        try {
            const response = await fetch(API_URL_TEXT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text || "Failed to retrieve recovery advice.";
            setAdvice(generatedText);

        } catch (err) {
            console.error("Gemini BJJ Advisor API Error:", err);
            setError("Failed to generate BJJ recovery advice.");
        } finally {
            setLoading(false);
        }
    }, [lastWorkout, recoveryData]);

    return (
        <div className={`p-5 rounded-xl shadow-lg ${cardColor} border border-gray-700`}>
            <h4 className="text-xl font-bold mb-3 text-red-400">BJJ Recovery Advisor</h4>
            <button
                onClick={generateAdvice}
                disabled={loading || !lastWorkout}
                className={`w-full py-2 px-4 rounded-lg font-bold text-white transition-all duration-300 ${loading ? 'bg-gray-500 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'}`}
            >
                {loading ? 'Analyzing...' : 'Get BJJ Warm-up Checklist'}
            </button>
            {advice && (
                <div className="mt-4 p-3 bg-gray-900 rounded-lg border border-red-700">
                    <p className="text-sm text-white whitespace-pre-line">{advice}</p>
                </div>
            )}
            {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
        </div>
    );
};

// --- AI FORM CUE GENERATOR ---
const AIFormCueGenerator = ({ cardColor }) => {
    const [selectedExercise, setSelectedExercise] = useState(WORKOUT_SCHEDULE[1].exercises[0].name);
    const [cues, setCues] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const generateCues = useCallback(async () => {
        setLoading(true);
        setCues([]);
        setError(null);

        const prompt = `Generate a concise, 3-point checklist of the most important form cues for maximizing hypertrophy on the ${selectedExercise}. The response must be only three short bullet points.`;
        const systemPrompt = "Act as an elite biomechanics expert. Your response must be a valid JSON array of strings, where each string is one short, actionable form cue. DO NOT include introductory or concluding text. Just the array.";

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "ARRAY",
                    items: { "type": "STRING" }
                }
            }
        };

        try {
            const response = await fetch(API_URL_TEXT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            
            const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
            const parsedCues = JSON.parse(jsonText);
            
            if (Array.isArray(parsedCues)) {
                setCues(parsedCues);
            } else {
                setError("Invalid JSON format received from AI.");
            }

        } catch (err) {
            console.error("Gemini Form Cue API Error:", err);
            setError("Failed to generate form cues.");
        } finally {
            setLoading(false);
        }
    }, [selectedExercise]);

    // Gather all unique exercises for the selector
    const allExercises = useMemo(() => [
        ...WORKOUT_SCHEDULE[1].exercises, 
        ...WORKOUT_SCHEDULE[2].exercises,
        ...WORKOUT_SCHEDULE[4].exercises,
        ...WORKOUT_SCHEDULE[5].exercises
    ], []);
    const uniqueExercises = [...new Map(allExercises.map(item => [item.name, item])).values()];


    return (
        <div className="space-y-6">
            <div className={`p-5 rounded-xl shadow-lg ${cardColor} border border-red-800`}>
                <h4 className="text-xl font-bold mb-3 text-pink-400 flex items-center">
                    <span className="mr-2">🏋️‍♀️</span> ✨ Form Cue Generator
                </h4>
                <select
                    value={selectedExercise}
                    onChange={(e) => { setSelectedExercise(e.target.value); setCues([]); }}
                    className="w-full p-2 rounded-lg bg-gray-700 text-white border border-gray-600 mb-4"
                >
                    {uniqueExercises.map(ex => (
                        <option key={ex.id} value={ex.name}>{ex.name}</option>
                    ))}
                </select>
                <button
                    onClick={generateCues}
                    disabled={loading}
                    className={`w-full py-2 px-4 rounded-lg font-bold text-white transition-all duration-300 ${loading ? 'bg-gray-500 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'}`}
                >
                    {loading ? 'Generating Cues...' : `Generate Cues for ${selectedExercise}`}
                </button>

                {cues.length > 0 && (
                    <ul className="mt-4 p-3 bg-gray-900 rounded-lg border border-red-700 space-y-1">
                        {cues.map((cue, index) => (
                            <li key={index} className="text-sm text-white list-disc ml-4">{cue}</li>
                        ))}
                    </ul>
                )}
                {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
            </div>
            
            <h3 className="text-3xl font-extrabold text-red-400 mb-6 border-b border-gray-700 pb-3">Exercise Library</h3>

            {/* List of Exercises (Existing Feature) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {uniqueExercises.map((ex, index) => (
                    <div key={index} className={`p-4 rounded-xl shadow-lg ${cardColor} border border-gray-700`}>
                        <p className="text-lg font-bold text-white">{ex.name}</p>
                        <p className="text-sm text-red-400 mt-1">{ex.muscle}</p>
                        <p className="text-xs text-gray-500 mt-2 italic">
                            Goal: {ex.repRange} Reps | Cue: {ex.technique.substring(0, 50)}...
                        </p>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- NUTRITION TAB ---
const NutritionCoach = ({ cardColor }) => {
    const [advice, setAdvice] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const generateNutritionPlan = useCallback(async () => {
        setLoading(true);
        setAdvice('');
        setError(null);
        
        // FIX: Replaced undefined variable AM with the constant LIFT_TIME
        const prompt = `Generate a single, concise, high-protein daily meal timing and macro plan for a ${USER_WEIGHT}lb male aiming for hypertrophy. The user lifts at ${LIFT_TIME} and does BJJ (Brazilian Jiu-Jitsu) 2x per week. Provide a sample schedule focusing on protein, carbs before ${LIFT_TIME} lift, and post-workout recovery. Include estimated macronutrients for the day (e.g., Protein: 220g, Carbs: 350g, Fat: 80g). Format the output cleanly with headings for Timing and Macros.`;

        const systemPrompt = "Act as a sports nutrition specialist. Your response must be highly actionable, easy to read, and focused on peri-workout nutrition for early morning lifters and BJJ recovery. Do not include external links or general fitness disclaimers.";

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
        };

        try {
            const response = await fetch(API_URL_TEXT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text || "Failed to retrieve nutrition plan.";
            setAdvice(generatedText);

        } catch (err) {
            console.error("Gemini Nutrition API Error:", err);
            setError("Failed to generate nutrition plan.");
        } finally {
            setLoading(false);
        }
    }, []);

    return (
        <div className="space-y-6">
            <h3 className="text-3xl font-extrabold text-red-400 mb-6 border-b border-gray-700 pb-3">AI Nutrition Coach</h3>
            
            <div className={`p-5 rounded-xl shadow-lg ${cardColor} border border-red-800`}>
                <h4 className="text-xl font-bold mb-3 text-pink-400 flex items-center">
                    <span className="mr-2">🍽️</span> Personalized Meal Timing
                </h4>
                <p className="text-sm text-gray-400 mb-4">
                    Based on your {LIFT_TIME} lifts and {USER_WEIGHT} lb goal, this provides a highly optimized sample macro plan.
                </p>
                <button
                    onClick={generateNutritionPlan}
                    disabled={loading}
                    className={`w-full py-3 px-4 rounded-lg font-bold text-white transition-all duration-300 ${loading ? 'bg-gray-500 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'}`}
                >
                    {loading ? 'Generating Plan...' : 'Generate 24-Hour Plan'}
                </button>

                {advice && (
                    <div className="mt-4 p-4 bg-gray-900 rounded-lg border border-red-700">
                        <pre className="text-sm text-white whitespace-pre-wrap">{advice}</pre>
                    </div>
                )}
                {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
            </div>
        </div>
    );
};


// --- SPLASH SCREEN ---
const SplashScreen = ({ theme, onStart }) => {
    const bgColor = theme === 'dark' ? 'bg-gray-900' : 'bg-gray-100';
    const textColor = theme === 'dark' ? 'text-gray-100' : 'text-gray-900';

    return (
        <div className={`min-h-screen flex flex-col items-center justify-center ${bgColor} ${textColor} transition-colors duration-500 p-8`}>
            <div className="text-center">
                <div className="animate-pulse mb-6">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20 text-red-600 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                </div>
                <h1 className="text-5xl font-black text-red-400 mb-2">Hypertrophy Ascent</h1>
                <p className="text-lg text-gray-500">Your personalized training journey starts now.</p>
                <button
                    onClick={onStart}
                    className="mt-12 py-3 px-8 rounded-xl font-bold text-lg text-white transition-all duration-300 transform active:scale-95 bg-red-600 hover:bg-red-700 shadow-xl shadow-red-900/50"
                >
                    Start Your Ascent
                </button>
            </div>
        </div>
    );
};


// --- MAIN APP COMPONENT ---
const App = () => {
    const { db, userId, isAuthReady } = useFirebase();
    const { logs, saveLog } = useWorkoutLogs(db, userId, isAuthReady);
    const { recoveryLogs, saveRecoveryData, recoveryChartData } = useRecoveryLogs(db, userId, isAuthReady);
    const { kpis, volumeData } = useKPIs(logs);

    const [currentDate, setCurrentDate] = useState(new Date());
    const [activeTab, setActiveTab] = useState('home'); 
    const [theme, setTheme] = useState('dark'); 
    const [hasStarted, setHasStarted] = useState(false); 

    const [timerSettings, setTimerSettings] = useState({ isRunning: false, initialTime: 90 });

    const toggleTheme = () => setTheme(prev => (prev === 'light' ? 'dark' : 'light'));

    const navigateDate = (days) => {
        const newDate = new Date(currentDate);
        newDate.setDate(newDate.getDate() + days);
        setCurrentDate(newDate);
    };

    const dateString = formatDate(currentDate);
    const workoutLogData = logs[dateString] || null;
    const recoveryData = recoveryLogs[dateString] || {};

    const currentWorkout = useMemo(() => {
        return getWorkoutForDate(currentDate, logs);
    }, [currentDate, logs]);

    const [localLog, setLocalLog] = useState(null);
    const [prevLogData, setPrevLogData] = useState(null); 

    useEffect(() => {
        if (currentWorkout) {
            let lastLog = null;
            const sortedDates = Object.keys(logs).filter(date => logs[date].isComplete).sort().reverse();
            for (const date of sortedDates) {
                if (logs[date]?.name === currentWorkout.name) {
                    lastLog = logs[date];
                    break;
                }
            }
            setPrevLogData(lastLog);

            // Determine if we need to load or create a new log
            const initialLog = workoutLogData ? { ...workoutLogData } : {
                name: currentWorkout.name,
                isComplete: false,
                exercises: currentWorkout.exercises.map(ex => ({
                    ...ex,
                    setsData: Array(ex.sets).fill().map((_, index) => ({
                        set: index + 1,
                        weight: 0,
                        reps: 0,
                        isDone: false,
                    }))
                }))
            };
            setLocalLog(initialLog);
        } else {
            setLocalLog(null);
            setPrevLogData(null); // Clear previous data if it's a rest day
        }
    }, [currentWorkout, workoutLogData, logs]);

    const handleSetChange = useCallback((exId, setIndex, field, value) => {
        setLocalLog(prevLog => {
            if (!prevLog) return prevLog;
            
            const updatedExercises = prevLog.exercises.map(ex => {
                if (ex.id === exId) {
                    const updatedSetsData = ex.setsData.map((set, index) => {
                        if (index === setIndex) {
                            const newValue = field === 'isDone' ? value : Number(value);
                            return { ...set, [field]: newValue };
                        }
                        return set;
                    });
                    return { ...ex, setsData: updatedSetsData };
                }
                return ex;
            });

            const allSetsDone = updatedExercises.every(ex => ex.setsData.every(set => set.isDone));
            
            return {
                ...prevLog,
                exercises: updatedExercises,
                isComplete: allSetsDone
            };
        });
    }, []);

    useEffect(() => {
        // Save workout log
        if (localLog && db && userId && isAuthReady) {
             saveLog(dateString, localLog);
        }
        
    }, [localLog, dateString, saveLog, db, userId, isAuthReady]);

    const bgColor = theme === 'dark' ? 'bg-gray-900' : 'bg-gray-100';
    const textColor = theme === 'dark' ? 'text-gray-100' : 'text-gray-900';
    const cardColor = theme === 'dark' ? 'bg-gray-800' : 'bg-white';
    const buttonPrimary = theme === 'dark' ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-red-500 hover:bg-red-600 text-white';
    const inputColor = theme === 'dark' ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-50 border-gray-300 text-gray-900';


    // --- RENDER FUNCTIONS ---
    if (!isAuthReady || !hasStarted) {
        return <SplashScreen theme={theme} onStart={() => setHasStarted(true)} />;
    }

    const renderContent = () => {
        switch (activeTab) {
            case 'home':
                return <HomeDashboard 
                    localLog={localLog} 
                    currentDate={currentDate} 
                    kpis={kpis} 
                    volumeData={volumeData} 
                    cardColor={cardColor} 
                    recoveryData={recoveryData}
                    saveRecoveryData={saveRecoveryData}
                    userId={userId}
                />;
            case 'training':
                return (
                    <TrainingProgram 
                        localLog={localLog}
                        prevLogData={prevLogData}
                        currentDate={currentDate}
                        navigateDate={navigateDate}
                        handleSetChange={handleSetChange}
                        inputColor={inputColor}
                        cardColor={cardColor}
                        buttonPrimary={buttonPrimary}
                        logs={logs}
                        userId={userId}
                        timerSettings={timerSettings}
                        setTimerSettings={setTimerSettings}
                        isAuthReady={isAuthReady}
                        recoveryData={recoveryData}
                        saveRecoveryData={saveRecoveryData}
                    />
                );
            case 'progress':
                return <ProgressDashboard kpis={kpis} volumeData={volumeData} recoveryChartData={recoveryChartData} cardColor={cardColor} userId={userId} />;
            case 'library':
                return <AIFormCueGenerator cardColor={cardColor} />;
            case 'nutrition':
                return <NutritionCoach cardColor={cardColor} />;
            default:
                return <HomeDashboard 
                    localLog={localLog} 
                    currentDate={currentDate} 
                    kpis={kpis} 
                    volumeData={volumeData} 
                    cardColor={cardColor} 
                    recoveryData={recoveryData}
                    saveRecoveryData={saveRecoveryData}
                    userId={userId}
                />;
        }
    };

    // --- MAIN RENDER ---
    return (
        <div className={`min-h-screen ${bgColor} ${textColor} font-inter transition-colors duration-500`}>
            <div className="max-w-4xl mx-auto p-4 sm:p-6 pb-20">
                
                {/* Header and Controls */}
                <header className="flex justify-between items-center mb-6 pt-4">
                    <h1 className="text-3xl font-black text-red-400">Hypertrophy Ascent</h1>
                    <div className="flex items-center space-x-3">
                        <button
                            onClick={toggleTheme}
                            className={`p-2 rounded-full transition-colors duration-300 ${cardColor} hover:text-red-400`}
                            title="Toggle Theme"
                        >
                            {theme === 'dark' ? 
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                                </svg>
                                :
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                                </svg>
                            }
                        </button>
                    </div>
                </header>

                {/* Main Content Rendered Here */}
                {renderContent()}
                
            </div>
            
            {/* BOTTOM FIXED NAVIGATION BAR (RP Inspired) */}
            <nav className={`fixed bottom-0 left-0 right-0 ${cardColor} border-t border-gray-700 shadow-2xl`}>
                <div className="max-w-4xl mx-auto flex justify-around">
                    {[
                        { id: 'home', label: 'Home', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg> },
                        { id: 'training', label: 'Training', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l-2 2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg> },
                        { id: 'progress', label: 'Progress', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M18 10a8 8 0 10-16 0 8 8 0 0016 0z" /></svg> },
                        { id: 'library', label: 'Library', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13a4.75 4.75 0 00-4.75 4.75v3.25l-2.25 2.25M12 6.253a4.75 4.75 0 014.75 4.75v3.25l2.25 2.25m-11.25 0h11.25" /></svg> },
                        { id: 'nutrition', label: 'Nutrition', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h14" /></svg> },
                    ].map(item => (
                        <button
                            key={item.id}
                            id={`${item.id}-tab`}
                            onClick={() => setActiveTab(item.id)}
                            className={`flex flex-col items-center p-3 text-xs font-medium transition-colors duration-300 ${
                                activeTab === item.id ? 'text-red-400' : 'text-gray-500 hover:text-gray-300'
                            }`}
                        >
                            {item.icon}
                            <span className="mt-1">{item.label}</span>
                        </button>
                    ))}
                </div>
            </nav>
        </div>
    );
};

export default App;
