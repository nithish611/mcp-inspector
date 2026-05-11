import { useHistoryStore, type HistoryEntry } from '@/stores/historyStore'
import { useServersStore } from '@/stores/serversStore'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { Activity, Clock, TrendingUp, AlertTriangle, Zap, BarChart3 } from 'lucide-react'
import { useMemo, useState } from 'react'

interface ToolStats {
  name: string
  count: number
  avgMs: number
  p50Ms: number
  p95Ms: number
  minMs: number
  maxMs: number
  errorRate: number
  lastCalled: number
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function PerformanceDashboard() {
  const { entries } = useHistoryStore()
  const { activeServerId } = useServersStore()
  const [selectedTool, setSelectedTool] = useState<string | null>(null)

  const serverEntries = useMemo(() => {
    if (!activeServerId) return []
    return entries[activeServerId] || []
  }, [entries, activeServerId])

  const toolStats = useMemo((): ToolStats[] => {
    const grouped: Record<string, HistoryEntry[]> = {}
    for (const entry of serverEntries) {
      if (!grouped[entry.toolName]) grouped[entry.toolName] = []
      grouped[entry.toolName].push(entry)
    }

    return Object.entries(grouped)
      .map(([name, entries]) => {
        const durations = entries.map((e) => e.durationMs).sort((a, b) => a - b)
        const errors = entries.filter((e) => e.isError).length
        return {
          name,
          count: entries.length,
          avgMs: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
          p50Ms: percentile(durations, 50),
          p95Ms: percentile(durations, 95),
          minMs: durations[0],
          maxMs: durations[durations.length - 1],
          errorRate: Math.round((errors / entries.length) * 100),
          lastCalled: Math.max(...entries.map((e) => e.timestamp)),
        }
      })
      .sort((a, b) => b.lastCalled - a.lastCalled)
  }, [serverEntries])

  const timelineData = useMemo(() => {
    const filtered = selectedTool
      ? serverEntries.filter((e) => e.toolName === selectedTool)
      : serverEntries
    return filtered
      .slice(-50)
      .map((e) => ({
        time: formatTime(e.timestamp),
        duration: e.durationMs,
        tool: e.toolName,
        isError: e.isError,
        timestamp: e.timestamp,
      }))
  }, [serverEntries, selectedTool])

  const overallStats = useMemo(() => {
    if (serverEntries.length === 0) return null
    const durations = serverEntries.map((e) => e.durationMs).sort((a, b) => a - b)
    const errors = serverEntries.filter((e) => e.isError).length
    return {
      totalCalls: serverEntries.length,
      avgMs: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      errorRate: Math.round((errors / serverEntries.length) * 100),
    }
  }, [serverEntries])

  const barData = useMemo(() => {
    return toolStats.map((t) => ({
      name: t.name.length > 16 ? t.name.slice(0, 14) + '…' : t.name,
      fullName: t.name,
      avg: t.avgMs,
      p95: t.p95Ms,
      errorRate: t.errorRate,
    }))
  }, [toolStats])

  if (!activeServerId) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Connect to a server to view performance data</p>
        </div>
      </div>
    )
  }

  if (serverEntries.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Activity className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No execution history yet</p>
          <p className="text-xs mt-1 opacity-70">Execute tools to see performance metrics</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      {/* Summary Stats */}
      {overallStats && (
        <div className="grid grid-cols-5 gap-3">
          <StatCard
            icon={<Zap className="h-4 w-4" />}
            label="Total Calls"
            value={overallStats.totalCalls.toString()}
          />
          <StatCard
            icon={<Clock className="h-4 w-4" />}
            label="Avg Latency"
            value={formatMs(overallStats.avgMs)}
          />
          <StatCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="P50"
            value={formatMs(overallStats.p50Ms)}
          />
          <StatCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="P95"
            value={formatMs(overallStats.p95Ms)}
            highlight={overallStats.p95Ms > 3000}
          />
          <StatCard
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Error Rate"
            value={`${overallStats.errorRate}%`}
            highlight={overallStats.errorRate > 10}
          />
        </div>
      )}

      {/* Latency Timeline Chart */}
      <Card variant="panel">
        <CardHeader className="p-4 pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Latency Timeline
              {selectedTool && (
                <Badge variant="secondary" className="text-[10px] gap-1">
                  {selectedTool}
                  <button onClick={() => setSelectedTool(null)} className="ml-1 hover:text-destructive">
                    ×
                  </button>
                </Badge>
              )}
            </CardTitle>
            <span className="text-[10px] text-muted-foreground">Last 50 executions</span>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timelineData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <defs>
                  <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(230, 89%, 62%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(230, 89%, 62%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  tickFormatter={(v) => formatMs(v)}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  labelStyle={{ color: 'hsl(var(--foreground))' }}
                  formatter={(value: any) => [formatMs(Number(value)), 'Latency']}
                  labelFormatter={(label, payload) => {
                    if (payload?.[0]?.payload?.tool) {
                      return `${payload[0].payload.tool} @ ${label}`
                    }
                    return label
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="duration"
                  stroke="hsl(230, 89%, 62%)"
                  strokeWidth={2}
                  fill="url(#latencyGradient)"
                  dot={(props: any) => {
                    const { cx, cy, payload } = props
                    if (payload.isError) {
                      return <circle cx={cx} cy={cy} r={4} fill="hsl(0, 78%, 56%)" stroke="none" />
                    }
                    return <circle cx={cx} cy={cy} r={2.5} fill="hsl(230, 89%, 62%)" stroke="none" />
                  }}
                  activeDot={{ r: 5, stroke: 'hsl(var(--background))', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Per-Tool Latency Bar Chart */}
      {barData.length > 1 && (
        <Card variant="panel">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Avg Latency by Tool
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    tickFormatter={(v) => formatMs(v)}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    formatter={(value: any) => [formatMs(Number(value)), 'Average']}
                    labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label}
                  />
                  <Bar dataKey="avg" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(data: any) => setSelectedTool(data.fullName)}>
                    {barData.map((entry, index) => (
                      <Cell
                        key={index}
                        fill={entry.errorRate > 20 ? 'hsl(0, 78%, 56%)' : 'hsl(230, 89%, 62%)'}
                        opacity={selectedTool && selectedTool !== entry.fullName ? 0.3 : 0.8}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tool Stats Table */}
      <Card variant="panel">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm">Tool Performance Details</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground">Tool</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Calls</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Avg</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">P50</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">P95</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Min</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Max</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Errors</th>
                </tr>
              </thead>
              <tbody>
                {toolStats.map((tool) => (
                  <tr
                    key={tool.name}
                    className={cn(
                      'border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors',
                      selectedTool === tool.name && 'bg-primary/5'
                    )}
                    onClick={() => setSelectedTool(selectedTool === tool.name ? null : tool.name)}
                  >
                    <td className="py-2 px-2 font-mono truncate max-w-[200px]" title={tool.name}>
                      {tool.name}
                    </td>
                    <td className="text-right py-2 px-2">{tool.count}</td>
                    <td className="text-right py-2 px-2 font-mono">{formatMs(tool.avgMs)}</td>
                    <td className="text-right py-2 px-2 font-mono">{formatMs(tool.p50Ms)}</td>
                    <td className={cn(
                      'text-right py-2 px-2 font-mono',
                      tool.p95Ms > 5000 && 'text-orange-500'
                    )}>
                      {formatMs(tool.p95Ms)}
                    </td>
                    <td className="text-right py-2 px-2 font-mono text-green-600 dark:text-green-400">
                      {formatMs(tool.minMs)}
                    </td>
                    <td className="text-right py-2 px-2 font-mono text-orange-500">
                      {formatMs(tool.maxMs)}
                    </td>
                    <td className={cn(
                      'text-right py-2 px-2',
                      tool.errorRate > 0 && 'text-destructive font-medium'
                    )}>
                      {tool.errorRate}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ icon, label, value, highlight }: {
  icon: React.ReactNode
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className={cn(
      'rounded-lg border border-border/70 p-3 bg-card/60',
      highlight && 'border-orange-500/50 bg-orange-500/5'
    )}>
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-[10px] font-medium">{label}</span>
      </div>
      <p className={cn(
        'text-lg font-semibold',
        highlight && 'text-orange-500'
      )}>
        {value}
      </p>
    </div>
  )
}
