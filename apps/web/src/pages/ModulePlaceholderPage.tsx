import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

interface ModulePlaceholderPageProps {
  title: string;
  phaseLabel: string;
  description: string;
  features: string[];
}

export function ModulePlaceholderPage({
  title,
  phaseLabel,
  description,
  features
}: ModulePlaceholderPageProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="soft-card p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-soft-line pb-4">
        <div>
          <span className="inline-block rounded-lg bg-brand-gradient px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
            {phaseLabel}
          </span>
          <h2 className="mt-2 text-xl font-bold text-soft-ink">{title}</h2>
          <p className="mt-1 text-sm text-soft-muted">{description}</p>
        </div>
        <Link
          to="/"
          className="rounded-xl border border-soft-line bg-soft-bg px-4 py-2 text-xs font-bold text-soft-ink transition-transform hover:-translate-y-0.5"
        >
          ← Volver al Dashboard
        </Link>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature, index) => (
          <div
            key={index}
            className="rounded-xl border border-soft-line bg-soft-bg p-4"
          >
            <span className="text-xs font-bold text-soft-blue">
              Módulo #{index + 1}
            </span>
            <p className="mt-1 text-sm font-semibold text-soft-ink">
              {feature}
            </p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
