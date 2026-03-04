export type StatusBadge = {
  label: string;
  color: string; // Tailwind classes used as a single string
  description: string;
  nextStep: string;
};

export type StaffMember = {
  name: string;
  present: boolean;
  timeIn?: string;
  timeOut?: string;
};

export type StudentClass = {
  name: string;
  progress: number;
  grade: string;
};

export type StaffNote = {
  text: string;
  author: string;
  timestamp: string;
};

export type Student = {
  id: string;
  name: string;
  attendanceCode: string;
  age: string | number;
  grade: string | number;
  cb?: string;
  lastSeenDate?: string;

  classes: StudentClass[];

  isPresent: boolean;
  signInTime?: string;
  signOutTime?: string;

  overallProgress: number;
  lowestProgress: number;

  courseMapStatus: string;

  studentNotes: string[];
  staffNotes: StaffNote[];

  statusBadge?: StatusBadge;
};

export const STATUS_LEGEND: Record<string, StatusBadge> = {
  LOCKED: {
    label: "Locked",
    color: "bg-rose-50 text-rose-700 border-rose-200",
    description: "This course is locked and cannot be worked on right now.",
    nextStep: "Verify why it is locked and contact the platform provider if needed."
  },
  "WAITING ON NEW COURSE": {
    label: "Waiting on New Course",
    color: "bg-amber-50 text-amber-700 border-amber-200",
    description: "Student is waiting for the next course to be opened/assigned.",
    nextStep: "Check schedule and request the next course to be opened."
  },
  "WAITING ON CCF": {
    label: "Waiting on CCF",
    color: "bg-sky-50 text-sky-700 border-sky-200",
    description: "Course completed but paperwork is pending.",
    nextStep: "Confirm CCF paperwork status and submit what is missing."
  },
  "PENDING CCF": {
    label: "Pending CCF",
    color: "bg-sky-50 text-sky-700 border-sky-200",
    description: "Course completed but paperwork is pending.",
    nextStep: "Confirm CCF paperwork status and submit what is missing."
  }
};