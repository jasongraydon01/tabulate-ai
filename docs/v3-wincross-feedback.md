The below was used to inform the following: docs/wincross-convention-fixes.md

---

Hi Jason,

 

We reviewed the job file and below are our observations:

 

General - In question titles, please remove the '|' symbol and replace it with a single space.
General - The NET intent level has already been set at the job level ('OI2'), so there is no need to specify it at the stub level.
General - In numeric-level questions, please do not provide all numeric ranges in the stub. Instead, use below one.  Providing all numeric stubs is fine if this is final data. However, if its for interim data some number stubs may be missing when new data is added.
AF= S7 (2-30)^    ^OA

Mean          ^S7 (2-30)^SM

Median        ^S7 (2-30)^SD

Std Dev       ^S7 (2-30)^SV

Std Err       ^S7 (2-30)^SR

Table 41 – We have a "<U+2019>" in the text. Kindly remove it.
General – For all the rating scale - Please always place '7 – Extremely Positive' as the top option. Currently, it is in the second row, and '6' is appearing first. – Example -  Table 56 (A100a)
Table 62 (A100b) – The factor code for 'Extremely Positive' should be 7, but it is currently listed as 1.
General – Generally, WinCross performs calculations at the table level using the following syntax:
Total^TN^0 – Shows the base as the sample size, regardless of the stubs provided at the stub level.
Total^TN^1 – Shows the answering base. If variable data is defined, any filter logic is applied here.
Total^TN^2 – Shows response-level calculation.
For summary tables, we should use Total^TN^0 or set the keyword PO(1-7) at the table level.  When PO(1-7) is used, table percentages are calculated based on qualified respondents.  Currently, all summary tables are set as Total^TN^1, which means the base value is calculated based on the row-level stub codes.  For example, in a Top 2 Box calculation, if codes 6 and 7 are provided, the base counts only respondents who selected 6 or 7. As a result, percentages in summary tables will not match those in individual tables. – Example – Table 58 (A100a)
If a special filter is required in summary tables or any orther tables, we should use Total^A100ar1 (6,7)^0
General – In OE tables, T1 data is already calculated based on the NET level. Please keep only the NET and remove T1, T2, and T3, keeping only T1.1, T1.2, etc., as T1 values are currently duplicated across two rows.
General – At the stub level, please keep only the attribute text/stub. For certain questions, we have question text also kindly remove. Example – Table no 484 (D700)
 

Can we schedule call early next week?

 

Thanks,

Poorna