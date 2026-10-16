export type Role = 'member' | 'instructor' | 'staff' | 'manager' | 'owner';
export type BookingStatus = 'booked' | 'checked_in' | 'cancelled' | 'late_cancel' | 'no_show';
export type SpotState = 'free' | 'taken' | 'mine' | 'off';
export type PaymentMethod = 'cash' | 'promptpay' | 'card' | 'transfer' | 'free';

export interface Branch { id: string; name: string; address: string | null; timezone: string; promptpay_id: string | null }

export interface Profile {
  id: string; branch_id: string | null; role: Role; display_name: string; phone: string | null;
  birthday: string | null; emergency_contact: string | null; avatar_url: string | null;
  pdpa_consent_at: string | null; tags: string[]; staff_note: string | null; checkin_code: string; created_at: string;
}

export interface Room { id: string; branch_id: string; name: string; kind: 'group' | 'vip'; turnover_minutes: number; sort_order: number; active: boolean }

export interface Fixture { type: 'mirror' | 'door' | 'instructor' | 'speaker'; x: number; y: number; w: number; h: number }

export interface Layout {
  id: string; room_id: string; name: string; equipment: string; cols: number; rows: number;
  fixtures: Fixture[]; active: boolean;
}

export interface LayoutSpot { id: string; layout_id: string; label: string; x: number; y: number; active: boolean }

export interface Instructor { id: string; branch_id: string; name: string; bio: string | null; photo_url: string | null; active: boolean }

export interface ClassType {
  id: string; branch_id: string; name: string; description: string | null; color: string;
  default_room_id: string | null; default_layout_id: string | null; duration_minutes: number; credit_cost: number;
  requires_vip: boolean; booking_window_days: number; cancel_cutoff_hours: number; active: boolean; sort_order: number;
}

export interface Session {
  id: string; branch_id: string; class_type_id: string; room_id: string; layout_id: string | null;
  instructor_id: string | null; starts_at: string; ends_at: string; capacity: number | null;
  status: 'scheduled' | 'cancelled'; note: string | null;
}

/** Session joined with the things a schedule row shows. */
export interface SessionRow extends Session {
  class_types: ClassType; rooms: Room; instructors: Instructor | null; layouts: Layout | null;
}

export interface Availability {
  session_id: string; capacity: number; booked: number; waiting: number;
  my_booking_id: string | null; my_spot_label: string | null; on_waitlist: boolean;
}

export interface SpotView { spot_id: string; label: string; x: number; y: number; state: SpotState }

export interface Booking {
  id: string; session_id: string; member_id: string; spot_id: string | null; status: BookingStatus;
  credits_used: number; needs_new_spot: boolean; created_at: string; cancelled_at: string | null; checked_in_at: string | null;
}

export interface Wallet {
  total: number; vip: number; next_expiry: string | null;
  lots: { id: string; vip: boolean; source: string; total: number; remaining: number; expires_at: string; created_at: string }[];
}

export interface Package {
  id: string; branch_id: string; name: string; description: string | null; kind: 'credit' | 'vip' | 'dropin' | 'trial';
  credits: number; validity_days: number; price: number; sell_online: boolean; once_per_member: boolean; active: boolean; sort_order: number;
}

export interface Product { id: string; branch_id: string; name: string; price: number; stock: number | null; active: boolean }

export interface Promotion {
  id: string; branch_id: string; title: string; body: string | null; image_url: string | null; package_id: string | null;
  discount_percent: number | null; code: string | null; audience_tag: string | null; starts_at: string; ends_at: string | null; active: boolean;
}

export interface Sale {
  id: string; branch_id: string; receipt_no: number; member_id: string | null; staff_id: string | null; channel: 'counter' | 'online';
  status: 'pending' | 'paid' | 'void'; payment_method: PaymentMethod; subtotal: number; discount: number; total: number;
  promo_code: string | null; created_at: string; paid_at: string | null; void_reason: string | null;
}

export interface Shift { id: string; opened_at: string; opening_cash: number; closed_at: string | null; counted_cash: number | null; expected_cash: number | null }
