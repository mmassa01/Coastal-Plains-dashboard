/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Search,
  User,
  Clock,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  X,
  BarChart3,
  Info,
  MessageSquare,
  Send,
  Users
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Student, STATUS_LEGEND, StaffMember } from "./types";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function toSheetDate(dateStr?: string) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return '';
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  return `${month}/${day}`;
}

export default function App() {
  const [students, setStudents] = useState<Student[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [activeDate, setActiveDate] = useState<string>('');
  const [requestedDateFound, setRequestedDateFound] = useState<boolean>(true);

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });

  const [activeGid, setActiveGid] = useState<string>('');
  const [googleApiStatus, setGoogleApiStatus] = useState<string>('NOT_CONFIGURED');
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const attendanceInFlight = useRef(false);

  const fetchData = useCallback(async (opts?: { isBackground?: boolean; force?: boolean; dateStr?: string }) => {
    const isBackground = !!opts?.isBackground;
    const force = !!opts?.force;
    const dateStr = opts?.dateStr ?? selectedDate;

    try {
      if (isBackground) setRefreshing(true);
      else setLoading(true);

      let url = `/api/data?t=${Date.now()}`;
      if (force) url += `&force=true`;

      const formattedDate = toSheetDate(dateStr);
      if (formattedDate) url += `&date=${encodeURIComponent(formattedDate)}`;

      const res = await fetch(url);
      const data = await res.json();

      if (data.roster) {
        setActiveDate(data.activeDate);
        setActiveGid(data.activeGid || '');
        setGoogleApiStatus(data.googleApiStatus || 'NOT_CONFIGURED');
        setRequestedDateFound(data.requestedDateFound !== false);
        setLastUpdated(new Date());
        setStaff(data.staffAttendance || []);

        const processed: Student[] = data.roster.map((row: any) => {
          const name = row.name;

          const overallProgress = row.classes?.length
            ? row.classes.reduce((acc: number, c: any) => acc + (c.progress || 0), 0) / row.classes.length
            : 0;

          const lowestProgress = row.classes?.length
            ? Math.min(...row.classes.map((c: any) => c.progress ?? 0))
            : 0;

          const courseMapInfo = data.courseMap?.[row.id] || { status: 'Course Mapping Needed', missing: [] };
          const courseMapStatus = courseMapInfo.status;

          const studentNotes = row.studentNotes || [];
          const staffNotes = data.overrides?.[row.id]?.notes || [];

          const statusKey = Object.keys(STATUS_LEGEND).find(k => row.notes?.includes(k));

          return {
            id: row.id || Math.random().toString(),
            name,
            attendanceCode: row.attendanceCode || 'Onsite',
            age: row.age || '?',
            grade: row.grade || '?',
            cb: row.cb,
            lastSeenDate: row.lastSeenDate,
            classes: row.classes || [],
            isPresent: false,
            signInTime: undefined,
            signOutTime: undefined,
            overallProgress,
            lowestProgress,
            courseMapStatus,
            studentNotes,
            staffNotes,
            statusBadge: statusKey ? STATUS_LEGEND[statusKey] : undefined
          };
        });

        setStudents(processed);

        if (selectedStudent) {
          const updated = processed.find(s => s.id === selectedStudent.id);
          if (updated) setSelectedStudent(updated);
        }
      }

      setLoading(false);
      setRefreshing(false);
    } catch (error) {
      console.error("Failed to fetch data", error);
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedDate, selectedStudent]);

  const fetchAttendance = useCallback(async (dateStr?: string) => {
    if (attendanceInFlight.current) return;
    attendanceInFlight.current = true;

    try {
      let url = `/api/attendance?t=${Date.now()}`;
      const formattedDate = toSheetDate(dateStr || selectedDate);
      if (formattedDate) url += `&date=${encodeURIComponent(formattedDate)}`;

      const res = await fetch(url);
      const data = await res.json();

      setActiveDate(data.activeDate);
      setActiveGid(data.activeGid || '');
      setGoogleApiStatus(data.googleApiStatus || 'NOT_CONFIGURED');
      setRequestedDateFound(data.requestedDateFound !== false);
      setLastUpdated(new Date());

      const attendanceMap = data.attendance || {};

      const resolveAttendance = (name: string) => {
        const normalizedName = name.toLowerCase().replace(/\s+/g, ' ').trim();
        return attendanceMap[normalizedName] || attendanceMap[name] || { present: false };
      };

      setStudents(prev =>
        prev.map(s => {
          const att = resolveAttendance(s.name);
          const isPresent = !!att.present;
          const signInTime = att.timeIn;
          const signOutTime = att.timeOut;
          const hasSignedIn = !!signInTime;

          return {
            ...s,
            isPresent: (isPresent || hasSignedIn) && s.attendanceCode !== 'Remote',
            signInTime,
            signOutTime
          };
        })
      );

      if (selectedStudent) {
        const att = resolveAttendance(selectedStudent.name);
        const hasSignedIn = !!att.timeIn;

        setSelectedStudent(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            isPresent: (att.present || hasSignedIn) && prev.attendanceCode !== 'Remote',
            signInTime: att.timeIn,
            signOutTime: att.timeOut
          };
        });
      }
    } catch (error) {
      console.error("Failed to fetch attendance", error);
    } finally {
      attendanceInFlight.current = false;
    }
  }, [selectedDate, selectedStudent]);

  useEffect(() => {
    fetchData({ dateStr: selectedDate });
    fetchAttendance(selectedDate);

    const attendanceInterval = setInterval(() => {
      fetchAttendance(selectedDate);
    }, 15000);

    const dataInterval = setInterval(() => {
      fetchData({ isBackground: true, dateStr: selectedDate });
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(attendanceInterval);
      clearInterval(dataInterval);
    };
  }, [selectedDate, fetchData, fetchAttendance]);

  const handleMarkComplete = async (studentId: string) => {
    try {
      const res = await fetch('/api/course-map/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId })
      });
      if (res.ok) {
        await fetchData({ isBackground: true, force: true, dateStr: selectedDate });
        await fetchAttendance(selectedDate);
      }
    } catch (error) {
      console.error("Failed to mark complete", error);
    }
  };

  const handleAddNote = async (studentId: string, note: string) => {
    try {
      const res = await fetch('/api/notes/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          note,
          author: "mmassa@mcintosh.k12.ga.us"
        })
      });
      if (res.ok) {
        await fetchData({ isBackground: true, force: true, dateStr: selectedDate });
      }
    } catch (error) {
      console.error("Failed to add note", error);
    }
  };

  const filteredStudents = useMemo(() => {
    return students.filter(s =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.id.includes(search)
    );
  }, [students, search]);

  const presentStudents = filteredStudents.filter(s => s.isPresent);
  const notPresentStudents = filteredStudents.filter(s => !s.isPresent);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-500 font-medium">Loading Coastal Plans Data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20">
      {googleApiStatus === 'API_DISABLED' && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-center gap-2 text-amber-800 text-xs font-medium">
          <AlertCircle size={14} />
          <span>Google Sheets API is disabled. Automatic tab discovery is currently unavailable.</span>
          <a
            href={`https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=732571017051`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-bold"
          >
            Enable API
          </a>
        </div>
      )}

      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Coastal Plans Live</h1>
            <div className="flex items-center gap-2 text-slate-500 text-sm mt-1">
              <Clock size={14} />
              <span>Active Session: <span className="font-semibold text-slate-700">{activeDate || 'None'}</span></span>
              {activeGid && (
                <span className="text-[10px] text-slate-400 font-mono bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                  GID: {activeGid}
                </span>
              )}
              <span className="mx-2">•</span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                {presentStudents.length} Present
              </span>
              <span className="mx-2">•</span>
              <span className="flex items-center gap-1">
                <CheckCircle2
                  size={14}
                  className={cn(
                    students.filter(s => s.isPresent && s.courseMapStatus === 'COMPLETE').length === presentStudents.length && presentStudents.length > 0
                      ? "text-emerald-500"
                      : "text-slate-400"
                  )}
                />
                {students.filter(s => s.isPresent && s.courseMapStatus === 'COMPLETE').length}/{presentStudents.length} Mapped
              </span>
              <span className="mx-2">•</span>
              <button
                onClick={() => setShowStaffModal(true)}
                className="flex items-center gap-1.5 px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors text-slate-700 font-bold"
              >
                <Users size={14} className="text-emerald-600" />
                {staff.filter(s => s.present && !s.timeOut).length} Staff on Campus
              </button>
              <span className="mx-2">•</span>
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                Updated: {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              {refreshing && (
                <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-bold animate-pulse">
                  <BarChart3 size={10} className="animate-spin" />
                  Refreshing...
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold ml-1">Select Date (Optional)</span>
              <div className="relative w-full md:w-56">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="date"
                  className="w-full pl-10 pr-10 py-2 bg-slate-100 border-transparent focus:bg-white focus:ring-2 focus:ring-emerald-500 rounded-xl transition-all outline-none text-sm font-medium text-slate-700"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
                {selectedDate && (
                  <button
                    onClick={() => setSelectedDate('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold ml-1">Search Students</span>
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  type="text"
                  placeholder="Search by name or ID..."
                  className="w-full pl-10 pr-4 py-2 bg-slate-100 border-transparent focus:bg-white focus:ring-2 focus:ring-emerald-500 rounded-xl transition-all outline-none"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <motion.button
            whileHover={{ y: -4 }}
            onClick={() => setShowStaffModal(true)}
            className="md:col-span-1 bg-emerald-600 rounded-3xl p-6 text-white shadow-lg shadow-emerald-200 flex items-center justify-between group overflow-hidden relative"
          >
            <div className="absolute top-0 right-0 -mr-4 -mt-4 w-24 h-24 bg-white/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-500"></div>
            <div className="flex flex-col items-start relative z-10">
              <span className="text-[10px] font-bold uppercase tracking-widest opacity-80 mb-1">Staff on Campus</span>
              <span className="text-4xl font-black">{staff.filter(s => s.present && !s.timeOut).length}</span>
              <span className="text-[10px] font-bold mt-3 flex items-center gap-1 bg-white/20 px-2 py-1 rounded-lg">
                View Details <ChevronRight size={12} className="group-hover:translate-x-1 transition-transform" />
              </span>
            </div>
            <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center relative z-10">
              <Users size={28} />
            </div>
          </motion.button>

          <div className="md:col-span-3 bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col justify-center">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Attendance Overview</h2>
              <div className="flex gap-4">
                <div className="flex flex-col items-end">
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Present</span>
                  <span className="text-xl font-black text-emerald-600">{presentStudents.length}</span>
                </div>
                <div className="flex flex-col items-end border-l border-slate-100 pl-4">
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Not Here</span>
                  <span className="text-xl font-black text-slate-300">{notPresentStudents.length}</span>
                </div>
              </div>
            </div>
            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden flex">
              <div
                className="h-full bg-emerald-500 transition-all duration-1000"
                style={{ width: `${(presentStudents.length / (students.length || 1)) * 100}%` }}
              />
            </div>
          </div>
        </div>

        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <div className="w-2 h-6 bg-emerald-500 rounded-full"></div>
              Present Now
            </h2>
            <span className="text-sm text-slate-500">{presentStudents.length} total</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {presentStudents.map(student => (
              <StudentTile
                key={student.id}
                student={student}
                onClick={() => setSelectedStudent(student)}
              />
            ))}
            {presentStudents.length === 0 && (
              <div className="col-span-full py-12 text-center bg-white rounded-2xl border border-dashed border-slate-300">
                <p className="text-slate-400 font-medium">No students currently marked as present.</p>
                {!requestedDateFound && (
                  <p className="text-xs text-slate-400 mt-2 bg-slate-50 inline-block px-3 py-1 rounded-full border border-slate-100 italic">
                    Note: No attendance data was found for {activeDate} in the spreadsheet.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        <section>
          <details open={false} className="group">
            <summary className="flex items-center justify-between mb-6 cursor-pointer list-none">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <div className="w-2 h-6 bg-slate-300 rounded-full"></div>
                Not Present
              </h2>
              <div className="flex items-center gap-2 text-slate-500 text-sm">
                <span>{notPresentStudents.length} total</span>
                <ChevronRight className="group-open:rotate-90 transition-transform" size={18} />
              </div>
            </summary>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pt-2">
              {notPresentStudents.map(student => (
                <StudentTile
                  key={student.id}
                  student={student}
                  onClick={() => setSelectedStudent(student)}
                />
              ))}
            </div>
          </details>
        </section>
      </main>

      <AnimatePresence>
        {selectedStudent && (
          <StudentProfile
            student={selectedStudent}
            onClose={() => setSelectedStudent(null)}
            onMarkComplete={handleMarkComplete}
            onAddNote={handleAddNote}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showStaffModal && (
          <StaffModal
            staff={staff}
            onClose={() => setShowStaffModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function StaffModal({ staff, onClose }: { staff: StaffMember[], onClose: () => void }) {
  const onCampus = staff.filter(s => s.present && !s.timeOut);
  const leftCampus = staff.filter(s => s.timeOut);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
      />

      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
      >
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-emerald-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600">
              <Users size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Staff on Campus</h2>
              <p className="text-xs text-emerald-700 font-medium">{onCampus.length} currently present</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/50 rounded-full transition-colors text-slate-400 hover:text-slate-600"
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-6 space-y-6">
          <section>
            <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-3">Currently Here</h3>
            <div className="space-y-2">
              {onCampus.length > 0 ? onCampus.map((s, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-emerald-50/50 rounded-xl border border-emerald-100">
                  <span className="font-bold text-slate-800">{s.name}</span>
                  <div className="flex flex-col items-end">
                    <span className="text-[9px] uppercase text-emerald-600 font-bold">Arrived</span>
                    <span className="text-xs font-bold text-slate-700">{s.timeIn}</span>
                  </div>
                </div>
              )) : (
                <p className="text-sm text-slate-400 italic text-center py-4">No staff currently signed in.</p>
              )}
            </div>
          </section>

          {leftCampus.length > 0 && (
            <section>
              <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-3">Signed Out</h3>
              <div className="space-y-2">
                {leftCampus.map((s, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 opacity-70">
                    <span className="font-bold text-slate-500">{s.name}</span>
                    <div className="flex gap-4">
                      <div className="flex flex-col items-end">
                        <span className="text-[9px] uppercase text-slate-400 font-bold">In</span>
                        <span className="text-xs font-bold text-slate-500">{s.timeIn}</span>
                      </div>
                      <div className="flex flex-col items-end border-l border-slate-200 pl-4">
                        <span className="text-[9px] uppercase text-slate-400 font-bold">Out</span>
                        <span className="text-xs font-bold text-slate-500">{s.timeOut}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </motion.div>
    </div>
  );
}

interface StudentTileProps {
  student: Student;
  onClick: () => void;
  key?: React.Key;
}

function StudentTile({ student, onClick }: StudentTileProps) {
  return (
    <motion.button
      layoutId={`tile-${student.id}`}
      onClick={onClick}
      whileHover={{ y: -4 }}
      className={cn(
        "flex flex-col p-5 rounded-2xl text-left transition-all border",
        student.isPresent
          ? "bg-white border-emerald-100 shadow-sm hover:shadow-md ring-1 ring-emerald-50"
          : "bg-slate-50 border-slate-200 opacity-80 grayscale-[0.2]"
      )}
    >
      <div className="flex justify-between items-start mb-3">
        <div
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            student.isPresent ? "bg-emerald-100 text-emerald-600" : "bg-slate-200 text-slate-500"
          )}
        >
          <User size={20} />
        </div>
        {student.statusBadge && (
          <span className={cn("status-badge border", student.statusBadge.color)}>
            {student.statusBadge.label}
          </span>
        )}
      </div>

      <h3 className="font-bold text-slate-900 text-lg leading-tight mb-1 line-clamp-1">
        {student.name}
      </h3>
      <p className="text-xs text-slate-500 font-medium mb-2">
        ID: {student.id} • Grade {student.grade}
      </p>

      {student.signInTime && (
        <div className="flex items-center gap-3 mb-4">
          <div className="flex flex-col">
            <span className="text-[9px] uppercase text-slate-400 font-bold">In</span>
            <span className="text-xs font-bold text-emerald-600">{student.signInTime}</span>
          </div>
          {student.signOutTime && (
            <div className="flex flex-col border-l border-slate-100 pl-3">
              <span className="text-[9px] uppercase text-slate-400 font-bold">Out</span>
              <span className="text-xs font-bold text-slate-500">{student.signOutTime}</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-auto pt-4 border-t border-slate-100 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Lowest Progress</span>
          <span className={cn(
            "text-sm font-bold",
            student.lowestProgress < 20 ? "text-red-500" : "text-slate-700"
          )}>
            {student.lowestProgress.toFixed(0)}%
          </span>
        </div>

        <div className={cn(
          "px-2 py-1 rounded-lg text-[10px] font-bold uppercase",
          student.courseMapStatus === 'COMPLETE' ? "bg-emerald-500 text-white" : "bg-red-600 text-white"
        )}>
          {student.courseMapStatus === 'COMPLETE' ? 'Course Mapping Complete' : 'Mapping Needed'}
        </div>
      </div>
    </motion.button>
  );
}

function StudentProfile({
  student,
  onClose,
  onMarkComplete,
  onAddNote
}: {
  student: Student,
  onClose: () => void,
  onMarkComplete: (id: string) => void,
  onAddNote: (id: string, note: string) => void
}) {
  const [newNote, setNewNote] = useState('');

  const handleSubmitNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (newNote.trim()) {
      onAddNote(student.id, newNote);
      setNewNote('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
      />

      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="relative w-full max-w-2xl h-full bg-white shadow-2xl overflow-y-auto"
      >
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-8 py-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400">
              <User size={28} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-900">{student.name}</h2>
              <p className="text-slate-500">
                Grade {student.grade} • Age {student.age} • ID: {student.id} {student.cb && `• CB: ${student.cb}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600"
          >
            <X size={24} />
          </button>
        </div>

        <div className="p-8 space-y-8">
          {student.courseMapStatus === 'COMPLETE' ? (
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-6 flex items-center gap-3">
              <CheckCircle2 className="text-emerald-500 shrink-0" size={20} />
              <div>
                <h4 className="font-bold text-emerald-800">Course Mapping Complete</h4>
                <p className="text-emerald-700 text-sm">Verified by staff on {new Date().toLocaleDateString()}.</p>
              </div>
            </div>
          ) : (
            student.isPresent && (
              <div className="bg-red-50 border border-red-100 rounded-2xl p-6 flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="text-red-500 shrink-0" size={20} />
                  <div>
                    <h4 className="font-bold text-red-800">Teacher action needed</h4>
                    <p className="text-red-700 text-sm">Course map has not been checked tonight. Please review with student.</p>
                  </div>
                </div>
                <button
                  onClick={() => onMarkComplete(student.id)}
                  className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-lg shadow-red-200"
                >
                  <CheckCircle2 size={18} />
                  Mark Course Map Completed
                </button>
              </div>
            )
          )}

          <section>
            <div className="flex items-center gap-2 mb-4">
              <Clock className="text-slate-400" size={18} />
              <h3 className="font-bold text-slate-800 uppercase text-xs tracking-widest">Attendance Status</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-xs text-slate-400 font-medium block mb-1">Current Status</span>
                <div className="flex items-center gap-2">
                  <div className={cn("w-2 h-2 rounded-full", student.isPresent ? "bg-emerald-500" : "bg-slate-300")}></div>
                  <span className="font-bold text-slate-700">{student.isPresent ? 'Present' : 'Not Present'}</span>
                </div>
              </div>
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-xs text-slate-400 font-medium block mb-1">Attendance Code</span>
                <span className="font-bold text-slate-700">{student.attendanceCode}</span>
              </div>
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-xs text-slate-400 font-medium block mb-1">Time In</span>
                <span className="font-bold text-slate-700">{student.signInTime || '--:--'}</span>
              </div>
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-xs text-slate-400 font-medium block mb-1">Time Out</span>
                <span className="font-bold text-slate-700">{student.signOutTime || '--:--'}</span>
              </div>
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 col-span-2">
                <span className="text-xs text-slate-400 font-medium block mb-1">Last Activity Date</span>
                <span className="font-bold text-slate-700">{student.lastSeenDate || 'No record'}</span>
              </div>
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="text-slate-400" size={18} />
                <h3 className="font-bold text-slate-800 uppercase text-xs tracking-widest">Course Progress</h3>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Overall</span>
                  <span className="font-bold text-emerald-600">{student.overallProgress.toFixed(1)}%</span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {student.classes.map((c: any, idx: number) => (
                <div key={idx} className="p-4 rounded-2xl border border-slate-100 bg-white shadow-sm">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-slate-700">{c.name}</span>
                    <span className="text-sm font-bold text-slate-500">Grade Equivalency: {c.grade}</span>
                  </div>
                  <div className="relative h-3 w-full bg-slate-100 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${c.progress}%` }}
                      className={cn(
                        "h-full rounded-full transition-all",
                        c.progress > 80 ? "bg-emerald-500" : c.progress > 50 ? "bg-blue-500" : "bg-amber-500"
                      )}
                    />
                  </div>
                  <div className="mt-1 text-right">
                    <span className="text-xs font-bold text-slate-400">{c.progress}% Complete</span>
                  </div>
                </div>
              ))}
              {student.classes.length === 0 && (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400">
                  No active courses found.
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Info className="text-slate-400" size={18} />
                <h3 className="font-bold text-slate-800 uppercase text-xs tracking-widest">Student Notes (From Sheet)</h3>
              </div>
              <div className={cn(
                "px-3 py-1 rounded-full text-xs font-bold uppercase",
                student.courseMapStatus === 'COMPLETE' ? "bg-emerald-100 text-emerald-700" :
                student.courseMapStatus === 'IN PROGRESS' ? "bg-amber-100 text-amber-700" :
                "bg-red-600 text-white"
              )}>
                Course Map: {student.courseMapStatus}
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-slate-50 border border-slate-100 mb-6">
              {student.studentNotes.length > 0 ? (
                <div className="space-y-3">
                  {student.studentNotes.map((note: string, idx: number) => (
                    <div key={idx} className="flex items-start gap-3 text-slate-700">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                      <span className="font-medium">{note}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-3 text-slate-400 italic">
                  <span>No specific notes from the spreadsheet.</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 mb-4">
              <MessageSquare className="text-slate-400" size={18} />
              <h3 className="font-bold text-slate-800 uppercase text-xs tracking-widest">Interactive Staff Notes</h3>
            </div>

            <div className="space-y-4">
              <div className="p-6 rounded-2xl bg-white border border-slate-100 shadow-sm">
                <div className="space-y-4 mb-6 max-h-60 overflow-y-auto pr-2">
                  {student.staffNotes && student.staffNotes.length > 0 ? (
                    student.staffNotes.map((note: any, idx: number) => (
                      <div key={idx} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] font-bold text-emerald-600 uppercase">{note.author}</span>
                          <span className="text-[10px] text-slate-400">{new Date(note.timestamp).toLocaleString()}</span>
                        </div>
                        <p className="text-sm text-slate-700">{note.text}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-400 italic text-center py-4">No staff notes yet. Be the first to add one!</p>
                  )}
                </div>

                <form onSubmit={handleSubmitNote} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Add a note or comment..."
                    className="flex-1 bg-slate-100 border-transparent focus:bg-white focus:ring-2 focus:ring-emerald-500 rounded-xl px-4 py-2 text-sm outline-none transition-all"
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                  />
                  <button
                    type="submit"
                    disabled={!newNote.trim()}
                    className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white p-2 rounded-xl transition-colors"
                  >
                    <Send size={18} />
                  </button>
                </form>
              </div>
            </div>
          </section>

          {student.statusBadge && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Info className="text-slate-400" size={18} />
                <h3 className="font-bold text-slate-800 uppercase text-xs tracking-widest">Status Notes</h3>
              </div>
              <div className={cn("p-6 rounded-2xl border", student.statusBadge.color)}>
                <h4 className="font-bold text-lg mb-1">{student.statusBadge.label}</h4>
                <p className="text-sm opacity-90 mb-4">{student.statusBadge.description}</p>
                <div className="pt-4 border-t border-current border-opacity-20">
                  <span className="text-[10px] uppercase font-bold block mb-1 opacity-70">Suggested Next Step</span>
                  <p className="font-bold">{student.statusBadge.nextStep}</p>
                </div>
              </div>
            </section>
          )}
        </div>
      </motion.div>
    </div>
  );
}