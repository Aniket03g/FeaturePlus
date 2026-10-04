"""
The four signal classes, one module each.

They are deliberately separate because trial 3's central correction was that
signals must be judged by *class*, not counted individually: pages and routes
looked like two signals agreeing when they were one fact read twice.

  names.py        code layout   - pages, route tables, directory names
  schema.py       data model    - CREATE TABLE, ORM models, generated types
  commits.py      history       - what the author said they were building
  cochange.py     history       - what changes together, and whether to trust it

`independence.py` measures whether any two of these are actually independent on
a given repo, rather than assuming it.
"""
