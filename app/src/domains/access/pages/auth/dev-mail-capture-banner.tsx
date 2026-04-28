interface DevMailCaptureBannerProps {
  url: string;
}

export function DevMailCaptureBanner({ url }: DevMailCaptureBannerProps) {
  return (
    <div className="rounded-2xl bg-amber-50 px-4 py-3">
      <p className="type-body-small text-amber-900">
        Dev mode —{" "}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="type-label-small text-amber-700 hover:underline"
        >
          Open mail capture &rarr;
        </a>
      </p>
    </div>
  );
}
