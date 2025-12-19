
export enum Category {
  Career = 'Career',
  Money = 'Money',
  Education = 'Education',
  Health = 'Health',
  Relationships = 'Relationships',
  Personal = 'Personal'
}

export enum TimeHorizon {
  OneYear = '1 Year',
  FiveYears = '5 Years',
  TenYears = '10 Years'
}

export enum GoalStatus {
  NotStarted = 'Not Started',
  InProgress = 'In Progress',
  Completed = 'Completed'
}

export interface Dream {
  id: string;
  title: string;
  description: string;
  category: Category;
  timeHorizon: TimeHorizon;
  createdAt: string;
}

export interface Goal {
  id: string;
  dreamId: string;
  title: string;
  deadline?: string;
  status: GoalStatus;
  progress: number; // 0 to 100
}

export interface ActionLog {
  id: string;
  content: string;
  date: string;
  dreamId?: string;
}

export interface UserState {
  isGuest: boolean;
  email?: string;
}
