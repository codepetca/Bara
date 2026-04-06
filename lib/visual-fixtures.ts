export const visualSessionFixture = {
  session: {
    _id: "session-visual",
    title: "Homeroom",
    date: "2026-04-05",
    status: "open" as const,
    checkInToken: "visual-check-in-token",
  },
  roster: {
    _id: "roster-visual",
    name: "Grade 7 Homeroom",
  },
  counts: {
    total: 4,
    present: 2,
    late: 1,
    unmarked: 1,
    absent: 0,
  },
  rows: [
    {
      participantId: "participant-1",
      displayName: "Naomi Adams",
      firstName: "Naomi",
      lastName: "Adams",
      studentId: "10001",
      schoolEmail: "naomi@example.edu",
      status: "present" as const,
      lastMarkedAt: 1_775_396_800_000,
      modifiedAt: 1_775_396_800_000,
      linkStatus: "linked" as const,
      linkedAppUserId: "app-user-1",
    },
    {
      participantId: "participant-2",
      displayName: "Samir Ahmed",
      firstName: "Samir",
      lastName: "Ahmed",
      studentId: "10002",
      schoolEmail: undefined,
      status: "late" as const,
      lastMarkedAt: 1_775_396_860_000,
      modifiedAt: 1_775_396_860_000,
      linkStatus: "review_needed" as const,
      linkedAppUserId: undefined,
    },
    {
      participantId: "participant-3",
      displayName: "Chloe Andrews",
      firstName: "Chloe",
      lastName: "Andrews",
      studentId: "10003",
      schoolEmail: undefined,
      status: "unmarked" as const,
      lastMarkedAt: undefined,
      modifiedAt: 1_775_396_900_000,
      linkStatus: "unlinked" as const,
      linkedAppUserId: undefined,
    },
    {
      participantId: "participant-4",
      displayName: "Eli Bennett",
      firstName: "Eli",
      lastName: "Bennett",
      studentId: "10004",
      schoolEmail: undefined,
      status: "present" as const,
      lastMarkedAt: 1_775_396_920_000,
      modifiedAt: 1_775_396_920_000,
      linkStatus: "ambiguous" as const,
      linkedAppUserId: undefined,
    },
  ],
  unresolvedEvents: [
    {
      participantId: undefined,
      participantName: undefined,
      result: "review_needed" as const,
      reasonCode: "not_on_roster",
      createdAt: 1_775_396_940_000,
    },
  ],
};

export const visualHomeFixture = {
  rosters: [
    {
      _id: "roster-1",
      name: "Grade 7 Homeroom",
      createdAt: 1_775_318_400_000,
      studentCount: 28,
      hasActiveSession: true,
    },
    {
      _id: "roster-2",
      name: "Period 2 Science",
      createdAt: 1_775_232_000_000,
      studentCount: 24,
      hasActiveSession: false,
    },
  ],
};

export const visualRosterFixture = {
  roster: {
    _id: "roster-visual",
    name: "Grade 7 Homeroom",
  },
  activeSession: {
    _id: "session-visual",
  },
  students: [
    {
      _id: "participant-1",
      displayName: "Naomi Adams",
      studentId: "10001",
      linkStatus: "linked" as const,
      latestStatusLabel: "Present",
      latestStatusTone: "present" as const,
    },
    {
      _id: "participant-2",
      displayName: "Samir Ahmed",
      studentId: "10002",
      linkStatus: "review_needed" as const,
      latestStatusLabel: "Syncing",
      latestStatusTone: "loading" as const,
    },
    {
      _id: "participant-3",
      displayName: "Chloe Andrews",
      studentId: "10003",
      linkStatus: "unlinked" as const,
      latestStatusLabel: "Absent",
      latestStatusTone: "absent" as const,
    },
  ],
};

export const visualDisplayFixture = {
  displayContext: {
    title: "Homeroom",
    rosterName: "Grade 7 Homeroom",
    checkInToken: "visual-check-in-token",
  },
  liveSession: visualSessionFixture,
};

export const visualImportFixture = {
  rosterName: "Period 1 Homeroom",
  headers: ["Student ID", "Student Name", "Course Name"],
  rows: [
    {
      "Student ID": "10001",
      "Student Name": "Adams, Naomi",
      "Course Name": "Period 1 Homeroom",
    },
    {
      "Student ID": "10002",
      "Student Name": "Ahmed, Samir",
      "Course Name": "Period 1 Homeroom",
    },
    {
      "Student ID": "10003",
      "Student Name": "Andrews, Chloe",
      "Course Name": "Period 1 Homeroom",
    },
  ],
  fileName: "schoolcash-export.csv",
  mapping: {
    nameColumn: "Student Name",
    studentIdColumn: "Student ID",
    schoolEmailColumn: null,
    titleColumn: null,
  },
};

export const visualStudentCheckInFixture = {
  context: {
    roster: {
      name: "Grade 7 Homeroom",
    },
    session: {
      title: "Homeroom",
      status: "open" as const,
    },
  },
  result: {
    code: "present_marked" as const,
    title: "You are checked in",
    description: "Your attendance was recorded for today.",
    tone: "green" as const,
    attendanceStatus: "present" as const,
  },
  error: null,
  bootstrapError: null,
  isReady: true,
};
