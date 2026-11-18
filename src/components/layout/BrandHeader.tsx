interface BrandHeaderProps {
  title: string;
  description: string;
}

export default function BrandHeader({
  title,
  description,
}: BrandHeaderProps) {
  return (
    <header className="voucher-header">
      <img
        className="brand-logo"
        src="/logo.jpg"
        alt="גרציא מתנות ואירועים"
      />
      <div className="voucher-header-copy">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </header>
  );
}
