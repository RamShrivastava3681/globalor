import { createFileRoute, Link } from "@tanstack/react-router";
import { LayoutGrid, ChevronRight } from "lucide-react";
import { REPORT_CATEGORIES } from "@/lib/reports-utils";

export const Route = createFileRoute("/app/reports/")({
  component: ReportsLandingPage,
});

function ReportsLandingPage() {
  return (
    <div className="min-h-[calc(100vh-64px)] bg-gradient-to-b from-background to-muted/30">
      <div className="animate-fade-in border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
          <div className="animate-fade-in-up animate-stagger-1 flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <LayoutGrid className="h-4 w-4" />
            <span>Reports</span>
          </div>
          <h1 className="animate-fade-in-up animate-stagger-2 text-3xl font-bold tracking-tight">Reports Dashboard</h1>
          <p className="animate-fade-in-up animate-stagger-3 mt-2 text-muted-foreground max-w-2xl">
            Select a report below to view detailed insights about your business.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-10 md:px-8">
        {REPORT_CATEGORIES.map((category, catIdx) => (
          <div key={catIdx} className="animate-fade-in-up mb-12 last:mb-0" style={{ animationDelay: `${0.2 + catIdx * 0.1}s` }}>
            <div className="flex items-center gap-3 mb-6">
              <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {category.name}
              </span>
              <div className="h-px flex-1 bg-gradient-to-l from-border to-transparent" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {category.reports.map((report, reportIdx) => {
                const Icon = report.icon;
                const globalIdx = catIdx * 3 + reportIdx;
                return (
                  <Link
                    key={report.id}
                    to="/app/reports/$tab"
                    params={{ tab: report.id }}
                    className={`animate-fade-in-up group relative overflow-hidden rounded-xl border border-border bg-card p-6 text-left shadow-sm transition-all duration-200 hover:shadow-md hover:border-primary/20 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring block`}
                    style={{ animationDelay: `${0.4 + globalIdx * 0.08}s` }}
                  >
                    <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${report.color}`} />

                    <div className="flex items-start gap-4">
                      <div className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${report.iconBg} transition-all duration-200 group-hover:scale-105 group-hover:shadow-sm`}>
                        <Icon className={`h-6 w-6 ${report.iconColor}`} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors duration-200">
                          {report.label}
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                          {report.description}
                        </p>
                      </div>

                      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/40 transition-all duration-200 group-hover:text-primary group-hover:translate-x-0.5" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
