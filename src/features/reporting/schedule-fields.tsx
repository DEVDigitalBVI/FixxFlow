'use client';

import { useState } from 'react';

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function ScheduleTimingFields() {
  const [frequency, setFrequency] = useState('weekly');
  return (
    <>
      <label className="field">
        Frequency
        <select
          className="input"
          name="frequency"
          value={frequency}
          onChange={(event) => setFrequency(event.target.value)}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </label>
      <label className="field" hidden={frequency !== 'weekly'}>
        Day of week
        <select className="input" name="weekday" defaultValue="1" disabled={frequency !== 'weekly'}>
          {weekdays.map((day, index) => (
            <option key={day} value={index}>
              {day}
            </option>
          ))}
        </select>
      </label>
      <label className="field" hidden={frequency !== 'monthly'}>
        Day of month
        <input
          className="input"
          type="number"
          name="monthday"
          min={1}
          max={31}
          defaultValue={1}
          disabled={frequency !== 'monthly'}
        />
      </label>
      <label className="field">
        Hour
        <select className="input" name="runHour" defaultValue="8">
          {Array.from({ length: 24 }, (_, hour) => (
            <option key={hour} value={hour}>
              {String(hour).padStart(2, '0')}:00
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
