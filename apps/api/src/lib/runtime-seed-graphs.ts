import { BusinessHoursDay } from '@bothub/shared';

export function createDefaultBusinessHours(): BusinessHoursDay[] {
  return [
    { dayOfWeek: 0, isOpen: false, openTime: '09:00', closeTime: '14:00' },
    { dayOfWeek: 1, isOpen: true, openTime: '08:00', closeTime: '18:00' },
    { dayOfWeek: 2, isOpen: true, openTime: '08:00', closeTime: '18:00' },
    { dayOfWeek: 3, isOpen: true, openTime: '08:00', closeTime: '18:00' },
    { dayOfWeek: 4, isOpen: true, openTime: '08:00', closeTime: '18:00' },
    { dayOfWeek: 5, isOpen: true, openTime: '08:00', closeTime: '18:00' },
    { dayOfWeek: 6, isOpen: true, openTime: '09:00', closeTime: '13:00' }
  ];
}
