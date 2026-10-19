// 天気: ヘッダーのホバー概要と、クリックで開く詳細 (1時間ごと・週間予報)
import { Cloud, CloudRain, CloudSnow, CloudSun, Droplets, Sun, Sunrise, Sunset, Thermometer, Umbrella, Wind, X, Zap } from 'lucide-react';

export interface WeatherDay {
  date: string;
  weatherCode: number;
  desc: string;
  tempMax: number | null;
  tempMin: number | null;
  precipProb: number | null;
}

export interface WeatherInfo {
  temp: number | null;
  desc: string;
  weatherCode?: number;
  tempMax?: number | null;
  tempMin?: number | null;
  precipProb?: number | null;
  humidity?: number | null;
  feelsLike?: number | null;
  windSpeed?: number | null;
  sunrise?: string | null;
  sunset?: string | null;
  daily?: WeatherDay[];
  hourly?: { time: string; temp: number; weatherCode: number; precipProb: number | null }[];
  source?: string;
}

export function weatherIcon(code: number | undefined) {
  const c = code ?? -1;
  if (c < 0) return CloudSun;
  if (c <= 1) return Sun;
  if (c <= 3) return c === 2 ? CloudSun : Cloud;
  if (c >= 95) return Zap;
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return CloudSnow;
  if (c >= 51) return CloudRain;
  return Cloud;
}

const dayName = (date: string, i: number) => {
  if (i === 0) return '今日';
  if (i === 1) return '明日';
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}(${'日月火水木金土'[d.getDay()]})`;
};

function TempPair({ max, min }: { max?: number | null; min?: number | null }) {
  return (
    <span className="tabular-nums">
      <span className="text-red-300">{max ?? '--'}°</span>
      <span className="text-stone-600"> / </span>
      <span className="text-sky-300">{min ?? '--'}°</span>
    </span>
  );
}

export function WeatherHoverSummary({ weather }: { weather: WeatherInfo }) {
  const Icon = weatherIcon(weather.weatherCode);
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3">
        <Icon className="w-8 h-8 text-amber-400" />
        <div>
          <div className="text-white font-bold text-base">{weather.temp ?? '--'}℃ <span className="text-sm font-normal text-stone-300">{weather.desc}</span></div>
          <div className="text-stone-500">高松市 · <TempPair max={weather.tempMax} min={weather.tempMin} /></div>
        </div>
      </div>
      {(weather.daily || []).length > 1 && (
        <div className="grid grid-cols-4 gap-1 pt-2 border-t border-stone-800">
          {(weather.daily || []).slice(0, 4).map((d, i) => {
            const DIcon = weatherIcon(d.weatherCode);
            return (
              <div key={d.date} className="flex flex-col items-center gap-0.5 text-[10px]">
                <span className="text-stone-400">{dayName(d.date, i)}</span>
                <DIcon className="w-4 h-4 text-amber-400" />
                <TempPair max={d.tempMax} min={d.tempMin} />
                {d.precipProb != null && <span className="text-sky-300">{d.precipProb}%</span>}
              </div>
            );
          })}
        </div>
      )}
      <div className="text-[10px] text-stone-600 text-right">クリックで詳しく</div>
    </div>
  );
}

export function WeatherDetail({ weather, onClose }: { weather: WeatherInfo; onClose: () => void }) {
  const Icon = weatherIcon(weather.weatherCode);
  const stats = [
    { icon: Thermometer, label: '体感', value: weather.feelsLike != null ? `${weather.feelsLike}℃` : '--' },
    { icon: Droplets, label: '湿度', value: weather.humidity != null ? `${weather.humidity}%` : '--' },
    { icon: Wind, label: '風速', value: weather.windSpeed != null ? `${weather.windSpeed}m/s` : '--' },
    { icon: Umbrella, label: '降水確率', value: weather.precipProb != null ? `${weather.precipProb}%` : '--' },
    { icon: Sunrise, label: '日の出', value: weather.sunrise || '--' },
    { icon: Sunset, label: '日の入り', value: weather.sunset || '--' },
  ];
  return (
    <>
      <div className="p-4 border-b border-stone-800 flex items-center justify-between">
        <span className="font-bold text-white text-sm">高松市の天気</span>
        <button onClick={onClose} className="p-1 rounded-lg text-stone-500 hover:text-white hover:bg-stone-800" aria-label="閉じる">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5 text-xs">
        <div className="flex items-center gap-4">
          <Icon className="w-14 h-14 text-amber-400" />
          <div>
            <div className="text-4xl font-black text-white tabular-nums">{weather.temp ?? '--'}℃</div>
            <div className="text-stone-300 text-sm">{weather.desc} · <TempPair max={weather.tempMax} min={weather.tempMin} /></div>
          </div>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {stats.map(s => (
            <div key={s.label} className="p-2.5 rounded-xl bg-[#16181D] border border-stone-800 flex flex-col items-center gap-1">
              <s.icon className="w-4 h-4 text-amber-400" />
              <span className="text-stone-500 text-[10px]">{s.label}</span>
              <span className="text-white font-bold tabular-nums">{s.value}</span>
            </div>
          ))}
        </div>

        {(weather.hourly || []).length > 0 && (
          <div className="space-y-2">
            <div className="text-stone-400 font-bold">1時間ごと</div>
            <div className="flex gap-1.5 overflow-x-auto pb-2">
              {(weather.hourly || []).map((h, i) => {
                const HIcon = weatherIcon(h.weatherCode);
                return (
                  <div key={`${h.time}-${i}`} className="shrink-0 w-14 py-2 rounded-xl bg-[#16181D] border border-stone-800 flex flex-col items-center gap-1">
                    <span className="text-stone-500 text-[10px]">{i === 0 ? '今' : h.time}</span>
                    <HIcon className="w-4 h-4 text-amber-400" />
                    <span className="text-white font-bold tabular-nums">{h.temp}°</span>
                    <span className="text-sky-300 text-[10px] tabular-nums">{h.precipProb ?? '-'}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(weather.daily || []).length > 0 && (
          <div className="space-y-2">
            <div className="text-stone-400 font-bold">週間予報</div>
            <div className="divide-y divide-stone-800/70 rounded-xl border border-stone-800 overflow-hidden">
              {(weather.daily || []).map((d, i) => {
                const DIcon = weatherIcon(d.weatherCode);
                return (
                  <div key={d.date} className="flex items-center gap-3 px-3 py-2.5 bg-[#16181D]/60">
                    <span className="w-20 text-stone-300 font-bold">{dayName(d.date, i)}</span>
                    <DIcon className="w-5 h-5 text-amber-400 shrink-0" />
                    <span className="flex-1 text-stone-400">{d.desc}</span>
                    <span className="w-12 text-right text-sky-300 tabular-nums">{d.precipProb != null ? `${d.precipProb}%` : '-'}</span>
                    <span className="w-20 text-right"><TempPair max={d.tempMax} min={d.tempMin} /></span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="text-[10px] text-stone-600">{weather.source === 'jma' ? '出典: 気象庁' : '出典: Open-Meteo'}</div>
      </div>
    </>
  );
}
