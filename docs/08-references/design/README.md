# Визуальные reference frames

Встроенный ImageGen, 28.09.2026. Макеты созданы до реализации, затем проанализированы: иерархия текста, поля, соотношение сцены и заголовка, формы кнопок, контраст и ритм секций.

`hero.png`: off-white #f2f2ef, крупный чёрный grotesk, двухстрочный Built with depth., стеклянная навигация, хромированная подпись справа. Удержаны иерархия, короткий текст и широкие поля; адаптация реальной формы NL сделана через 3D-геометрию.

`expertise.png`: раскрывающиеся три направления с тонкими разделителями. В реализации описание и предметная иллюстрация слева, сами направления справа, чтобы сохранить читаемость длинного RU текста.

`approach.png`: тёмный блок с крупным тезисом и тремя смысловыми пунктами. Убраны служебные номера/декоративные подписи, которые генератор добавил сам.

`projects.png`: одно широкое серебряное изображение и честная заглушка. Нет фальшивой карточки готового продукта.

`contact.png`: крупное приглашение, прозрачная кнопка, простой footer. Контакты ещё не предоставлены, поэтому есть локализованное пустое состояние.

## Prompts

Общая рамка: premium art-directed personal portfolio for Nick Lukashik, pale off-white gallery background, black modern grotesk, polished silver liquid calligraphic signature, selective liquid glass, generous margins, readable section references, no purple, no fake clients or metrics.

- Hero: "Built with depth."; "Full-stack engineering. From the first interaction to the infrastructure underneath."; black capsule "Explore my approach"; original intertwined chrome N/L on right; no clutter, no browser chrome.
- Expertise: "Depth across the stack."; accordion rows "Interfaces that feel right", "Systems that hold up", "From code to production"; chrome folded ribbon, no cards.
- Approach: graphite background; "The details make the difference."; "Think in systems.", "Build for people.", "Own the delivery."; open composition, readable paragraphs.
- Projects: "A space for what’s next."; wide chrome arc image; "Independent projects", "In the making"; honest placeholder.
- Contact: "Good things start with a conversation."; "Open to thoughtful products and ambitious teams."; "Contact details"; footer name and back-to-top.

Два production raster assets были сгенерированы отдельно, не вырезаны из UI-макетов:

- silver-study: square sculptural product photograph of one wide continuous polished chrome ribbon folding into an asymmetrical open S knot, strong black and white studio reflections, seamless pale background, no text or UI.
- silver-arc: wide close-up photograph of one sinuous chrome ribbon arch sweeping from lower left over the right side, black/white studio reflections, pale silver-gray background, no text or logos.

Результат сохранён в `apps/landing-web/public/` как исходные PNG и оптимизированные WebP. Hero-постер снят с собственной Three.js сцены через Playwright. Макеты не используются как растровая подложка всего интерфейса: текст, навигация, кнопки и сценография реализованы отдельно.
