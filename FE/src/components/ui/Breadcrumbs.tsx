import { Fragment } from "react";
import { Link } from "react-router-dom";

export interface Crumb {
  label: string;
  /** Bỏ trống ở mục cuối (trang hiện tại) */
  to?: string;
}

/** Đường dẫn điều hướng dùng chung cho mọi trang Admin: "Bộ sưu tập / Album A / Chế độ phân cảnh". */
export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Đường dẫn" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-2 font-mono text-xs font-medium text-zinc-400">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <Fragment key={`${item.label}-${index}`}>
              {index > 0 && (
                <li aria-hidden="true" className="text-zinc-600">
                  /
                </li>
              )}
              <li className={`min-w-0 ${isLast ? "truncate" : "shrink-0 max-w-[40vw] truncate sm:max-w-[16rem]"}`}>
                {item.to && !isLast ? (
                  <Link to={item.to} className="transition-colors hover:text-white">
                    {item.label}
                  </Link>
                ) : (
                  <span aria-current={isLast ? "page" : undefined} className={isLast ? "font-semibold text-indigo-400" : undefined}>
                    {item.label}
                  </span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
