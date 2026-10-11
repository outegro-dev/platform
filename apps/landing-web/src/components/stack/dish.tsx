import type { LiveLink } from "@/lib/stack";

/**
 * One line of the menu: the name, dot leaders to a joke price, the kitchen's
 * joke about it and what it really does in production, with live links.
 */
export function Dish({
  name,
  price,
  joke,
  fact,
  links,
  labels,
}: {
  name: string;
  price: string;
  joke: string;
  fact: string;
  links?: LiveLink[];
  labels: { price: string; fact: string; live: string };
}) {
  return (
    <li className="dish">
      <div className="dish-top">
        <h3 className="dish-name">{name}</h3>
        <span className="dish-dots" aria-hidden="true" />
        <p className="dish-price">
          <span className="sr-only">{labels.price}: </span>
          {price}
        </p>
      </div>
      <p className="dish-joke">{joke}</p>
      <p className="dish-fact">
        <span className="dish-label">{labels.fact}</span> {fact}
      </p>
      {links ? (
        <p className="dish-live">
          <span className="dish-label">{labels.live}</span>
          {links.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </p>
      ) : null}
    </li>
  );
}
