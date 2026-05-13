# Recurring Attendance Modes Review

- Reusable pattern: keep the roster detail page as the single control surface, and let data-source mode change the card content instead of adding new navigation.
- Strength: the attendance runtime stays unchanged once a session is open, which keeps the primary action understandable.
- Risk introduced: the roster detail page is getting denser because recurring schedule controls now sit beside share, export, and roster-management actions.
- Smallest high-impact improvement: split the recurring schedule card into a compact summary state and an explicit edit state if more linked-mode controls or exception editing get added.
